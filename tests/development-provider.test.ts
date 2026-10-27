import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/development/mock/route";
import { ChoiceGenerator } from "@/lib/generator";
import { JevProvider } from "@/lib/jev-provider";
import { DEFAULT_SETTINGS } from "@/lib/domain";
import { task } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("development-only HTTP provider", () => {
  it("runs the real development handler, serializer and generator through EOS", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const network = vi.fn((_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      headers.set("Origin", "https://app.example");
      return POST(new Request("https://app.example/api/development/mock", { ...init, headers }));
    });
    vi.stubGlobal("fetch", network);
    const generator = new ChoiceGenerator(task());
    await generator.start(
      new JevProvider({ ...DEFAULT_SETTINGS, provider: "mock" }, { token: "", extraHeaders: {} }),
    );
    expect(generator.getSnapshot().status).toBe("completed");
    expect(generator.getSnapshot().state).toBe(" !\"#$%&'");
    expect(generator.getSnapshot().history).toHaveLength(9);
    expect(generator.getSnapshot().history.at(-1)?.optionKey).toBe("eos");
    expect(generator.getSnapshot().history.every((round) => round.provider.includes("mock"))).toBe(
      true,
    );
    expect(network).toHaveBeenCalledTimes(9);
  });
  it("rejects all development Mock requests in a production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(
      new Request("https://app.example/api/development/mock", { method: "POST" }),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("not_found");
  });
});
