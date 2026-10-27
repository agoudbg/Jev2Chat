import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMS, DEFAULT_SETTINGS } from "@/lib/domain";
import { serverConfig, clientConfig } from "@/server/config";
import { handleChoice, handleConnection, handlePublicRun } from "@/server/handlers";
import { ApiError, clientKey, readBody, validateTarget } from "@/server/security";
import { RateLimiter } from "@/server/rate-limiter";
import { asciiVocabulary } from "@/lib/vocabulary";
import { answer } from "./helpers";
import { LuaRedisBoundary } from "./redis-boundary";

const config = (extra: Record<string, string | undefined> = {}) =>
  serverConfig({
    JEV_PUBLIC_ENABLED: "true",
    JEV_PUBLIC_TOKEN: "server-only-token",
    JEV_LIMITER_SECRET: "a-random-test-secret-at-least-32-characters",
    UPSTASH_REDIS_REST_URL: "https://test.invalid",
    UPSTASH_REDIS_REST_TOKEN: "redis-test-token",
    ...extra,
  });
const request = (path: string, data: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.example${path}`, {
    method: "POST",
    headers: { Origin: "https://app.example", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
  });
const payload = () => ({
  settings: DEFAULT_SETTINGS,
  credentials: { token: "user-only-token", extraHeaders: { "X-Test": "secret-header-value" } },
  timeoutMs: 30_000,
  input: {
    prompt: "Write",
    state: "",
    round: 1,
    requestId: `${crypto.randomUUID()}:1`,
    mode: "character",
    candidates: asciiVocabulary().candidates.filter((item) => item.enabled),
  },
});
const stores: LuaRedisBoundary[] = [];
function limiter(extra: Record<string, string | undefined> = {}) {
  const redis = new LuaRedisBoundary();
  stores.push(redis);
  const settings = config(extra);
  return { redis, limiter: new RateLimiter(redis, settings), config: settings };
}
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

describe("shared Redis public admission", () => {
  it("enforces maximum generation rounds and retries at run creation", async () => {
    const value = limiter({ JEV_PUBLIC_MAX_ROUNDS: "5" });
    await expect(value.limiter.createRun("a", { ...DEFAULT_PARAMS, maxRounds: 6 })).rejects.toThrow(
      "上限",
    );
    await expect(
      value.limiter.createRun("a", { ...DEFAULT_PARAMS, maxRounds: 5, retries: 2 }),
    ).rejects.toThrow("上限");
  });
  it("enforces IP frequency even after every lease is released", async () => {
    const value = limiter({ JEV_RATE_REQUESTS: "2" });
    const run = await value.limiter.createRun("a", DEFAULT_PARAMS);
    await (await value.limiter.acquire("a", run, 1, "hash1")).release();
    await (await value.limiter.acquire("a", run, 2, "hash2")).release();
    await expect(value.limiter.acquire("a", run, 3, "hash3")).rejects.toThrow("频率");
  });
  it("enforces shared global concurrency across limiter instances", async () => {
    const value = limiter({ JEV_GLOBAL_CONCURRENCY: "1" });
    const second = new RateLimiter(value.redis, value.config);
    const runA = await value.limiter.createRun("a", DEFAULT_PARAMS);
    const runB = await second.createRun("b", DEFAULT_PARAMS);
    const first = await value.limiter.acquire("a", runA, 1, "hash");
    await expect(second.acquire("b", runB, 1, "hash")).rejects.toThrow("并发");
    await first.release();
    await (await second.acquire("b", runB, 1, "hash")).release();
  });
  it("enforces IP concurrency independently of global concurrency", async () => {
    const value = limiter({ JEV_IP_CONCURRENCY: "1" });
    const run = await value.limiter.createRun("a", DEFAULT_PARAMS);
    const first = await value.limiter.acquire("a", run, 1, "hash");
    await expect(value.limiter.acquire("a", run, 2, "hash2")).rejects.toThrow("并发");
    await first.release();
  });
  it("enforces a global daily request budget across different IPs", async () => {
    const value = limiter({ JEV_GLOBAL_DAILY_REQUESTS: "1" });
    const runA = await value.limiter.createRun("a", DEFAULT_PARAMS);
    await (await value.limiter.acquire("a", runA, 1, "hash")).release();
    const runB = await value.limiter.createRun("b", DEFAULT_PARAMS);
    await expect(value.limiter.acquire("b", runB, 1, "hash")).rejects.toThrow("今天");
  });
  it("returns one cached result and rejects mismatched or foreign retries", async () => {
    const value = limiter();
    const run = await value.limiter.createRun("a", DEFAULT_PARAMS);
    const first = await value.limiter.acquire("a", run, 1, "same");
    await expect(value.limiter.acquire("a", run, 1, "same")).rejects.toThrow("处理");
    await first.release({ choice: "x" });
    expect((await value.limiter.acquire("a", run, 1, "same")).cached).toEqual({ choice: "x" });
    await expect(value.limiter.acquire("a", run, 1, "different")).rejects.toThrow("不同");
    await expect(value.limiter.acquire("b", run, 1, "same")).rejects.toThrow("客户端");
  });
  it("rejects out-of-range rounds and excess attempts", async () => {
    const value = limiter();
    const run = await value.limiter.createRun("a", { ...DEFAULT_PARAMS, maxRounds: 2, retries: 0 });
    await expect(value.limiter.acquire("a", run, 3, "hash")).rejects.toThrow("上限");
    await (await value.limiter.acquire("a", run, 1, "hash")).release();
    await expect(value.limiter.acquire("a", run, 1, "hash")).rejects.toThrow("上限");
  });
  it("releases expired leases after a terminated worker", async () => {
    const value = limiter({ JEV_GLOBAL_CONCURRENCY: "1" });
    const now = Date.now();
    const run = await value.limiter.createRun("a", DEFAULT_PARAMS);
    await value.limiter.acquire("a", run, 1, "hash");
    vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    await (await value.limiter.acquire("a", run, 2, "hash2")).release();
  });
});

describe("proxy security and HTTP boundary", () => {
  it("does not expose public or Redis Tokens in client config", () => {
    const json = JSON.stringify(clientConfig(config()));
    expect(json).not.toContain("server-only-token");
    expect(json).not.toContain("redis-test-token");
    expect(clientConfig(config({ JEV_PUBLIC_ENABLED: "false" })).publicEnabled).toBe(false);
    expect(clientConfig(config({ UPSTASH_REDIS_REST_URL: "" })).publicEnabled).toBe(false);
  });
  it("ignores spoofed forwarded IP headers without trusted proxy configuration", () => {
    expect(
      clientKey(
        request("/api/choice", {}, { "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4" }),
        config(),
      ),
    ).toBe(clientKey(request("/api/choice", {}, { "x-real-ip": "8.8.8.8" }), config()));
  });
  it("only accepts one IP after authenticating the configured proxy", () => {
    const trusted = config({
      JEV_IP_MODE: "trusted-proxy",
      JEV_TRUSTED_PROXY_SECRET: "another-test-secret-at-least-32-characters",
    });
    expect(() =>
      clientKey(request("/api/choice", {}, { "x-real-ip": "1.2.3.4" }), trusted),
    ).toThrow(ApiError);
    expect(() =>
      clientKey(
        request(
          "/api/choice",
          {},
          {
            "x-real-ip": "1.2.3.4,8.8.8.8",
            "x-jev-proxy-secret": trusted.JEV_TRUSTED_PROXY_SECRET,
          },
        ),
        trusted,
      ),
    ).toThrow("单一");
    const a = clientKey(
      request(
        "/api/choice",
        {},
        { "x-real-ip": "1.2.3.4", "x-jev-proxy-secret": trusted.JEV_TRUSTED_PROXY_SECRET },
      ),
      trusted,
    );
    const b = clientKey(
      request(
        "/api/choice",
        {},
        { "x-real-ip": "8.8.8.8", "x-jev-proxy-secret": trusted.JEV_TRUSTED_PROXY_SECRET },
      ),
      trusted,
    );
    expect(a).not.toBe(b);
  });
  it("rejects arbitrary targets, insecure upstreams and malformed paths", () => {
    for (const target of [
      "http://127.0.0.1",
      "http://169.254.169.254",
      "https://untrusted.example",
    ])
      expect(() => validateTarget(target, "/v1/systemone", config())).toThrow();
    expect(() => validateTarget("https://api.typesafe.ai", "//evil.example", config())).toThrow();
    expect(validateTarget("https://api.typesafe.ai", "/v1/systemone", config())).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
  });
  it("enforces body size from bytes even without content-length", async () => {
    await expect(
      readBody(request("/api/choice", { text: "a".repeat(10_000) }), 1_000),
    ).rejects.toThrow("大小");
  });
  it("keeps credentials out of responses and application logs", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const network = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user-only-token");
      expect(init.body).not.toContain("user-only-token");
      return Response.json({ ...answer("ascii_97"), unexpected_echo: "user-only-token" });
    });
    vi.stubGlobal("fetch", network);
    const result = await handleChoice(request("/api/choice", payload()), { config: config() });
    expect(result.status).toBe(200);
    expect(await result.text()).not.toContain("user-only-token");
    expect(JSON.stringify(log.mock.calls)).not.toContain("user-only-token");
  });
  it("redacts reflected secrets in upstream errors", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ detail: "Bad user-only-token / secret-header-value" }, { status: 401 }),
      ),
    );
    const result = await handleChoice(request("/api/choice", payload()), { config: config() });
    expect(result.status).toBe(502);
    const text = await result.text();
    expect(text).toContain("401");
    expect(text).not.toContain("user-only-token");
    expect(text).not.toContain("secret-header-value");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-header-value");
  });
  it("validates origin and headers before sending credentials upstream", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await handleChoice(
      request("/api/choice", payload(), { origin: "https://evil.example" }),
      { config: config() },
    );
    expect(result.status).toBe(403);
    expect(network).not.toHaveBeenCalled();
    const value = {
      ...payload(),
      credentials: { token: "test", extraHeaders: { Authorization: "injected" } },
    };
    expect((await handleChoice(request("/api/choice", value), { config: config() })).status).toBe(
      400,
    );
  });
  it("uses only the server Token in public mode and deduplicates repeat results", async () => {
    const value = limiter();
    const client = clientKey(request("/api/choice", {}), value.config);
    const run = await value.limiter.createRun(client, DEFAULT_PARAMS);
    const body = {
      ...payload(),
      settings: { ...DEFAULT_SETTINGS, transport: "public" },
      publicRunId: run,
    };
    const network = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer server-only-token",
      );
      return Response.json(answer("ascii_97"));
    });
    vi.stubGlobal("fetch", network);
    expect((await handleChoice(request("/api/choice", body), value)).status).toBe(200);
    const second = await handleChoice(request("/api/choice", body), value);
    expect(second.status).toBe(200);
    expect(await second.text()).not.toContain("server-only-token");
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("enforces public run limits through the HTTP endpoint", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const value = limiter({ JEV_PUBLIC_MAX_ROUNDS: "2" });
    expect((await handlePublicRun(request("/api/public/runs", DEFAULT_PARAMS), value)).status).toBe(
      400,
    );
  });
  it("projects only model names in connection responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          models: [{ name: "jev-latest", token: "user-only-token" }],
          token: "server-only-token",
        }),
      ),
    );
    const response = await handleConnection(request("/api/connection", payload()), {
      config: config(),
    });
    expect(await response.json()).toEqual({ models: [{ name: "jev-latest" }] });
  });
});
