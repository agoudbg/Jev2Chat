import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, readJsonLimited, redactJson } from "@/lib/http";
import { readBody } from "@/server/security";
import { provider, task, answer } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("bounded and sanitized HTTP", () => {
  it("uses the HTTP status for retry policy even when a response includes an arbitrary code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Rate limit", code: "http_1000" },
          { status: 429, headers: { "Retry-After": "2" } },
        ),
      ),
    );
    await expect(
      fetchJson("https://api.typesafe.ai/v1/systemone", {}, 1_000, new AbortController().signal),
    ).rejects.toMatchObject({ code: "http_429", retryable: true, retryAfterMs: 2_000 });
  });
  it("preserves HTTP overload semantics when an upstream error page is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>unavailable</html>", { status: 503 })),
    );
    await expect(
      fetchJson("https://api.typesafe.ai/v1/systemone", {}, 1_000, new AbortController().signal),
    ).rejects.toMatchObject({ code: "http_503", retryable: true, ambiguous: false });
  });
  it("redacts credential strings containing quotes or backslashes before JSON serialization", () => {
    const secret = 'a"quoted\\secret';
    const result = redactJson({ model: secret, nested: [secret], value: null }, [secret]);
    expect(result).toEqual({ model: "[redacted]", nested: ["[redacted]"], value: null });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("sanitizes reflected credentials in direct-provider round responses", async () => {
    const response = answer("eos");
    response.model = "test-only-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(response)),
    );
    const adapter = provider();
    const value = task();
    const result = await adapter.choose(
      adapter.prepare({
        prompt: value.prompt,
        state: "",
        mode: "character",
        candidates: value.vocabulary.candidates.filter((item) => item.enabled),
        round: 1,
        requestId: `${value.id}:1`,
      }),
      new AbortController().signal,
    );
    expect(JSON.stringify(result.response)).not.toContain("test-only-secret");
    expect(result.key).toBe("eos");
  });
  it("rejects invalid UTF-8 in requests and successful upstream responses", async () => {
    const bytes = new Uint8Array([34, 0xff, 34]);
    await expect(readJsonLimited(new Response(bytes))).rejects.toMatchObject({ code: "protocol" });
    await expect(
      readBody(new Request("https://app.example/api/choice", { method: "POST", body: bytes }), 100),
    ).rejects.toMatchObject({ code: "json" });
  });
  it("limits actual streamed response bytes", async () => {
    await expect(readJsonLimited(new Response('"too large"'), 5)).rejects.toMatchObject({
      code: "response_size",
    });
  });
});
