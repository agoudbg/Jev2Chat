import { afterEach, describe, expect, it, vi } from "vitest";
import { ChoiceGenerator } from "@/lib/generator";
import { answer, deferred, mockSequence, provider, task } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("recursive Choice generation", () => {
  it("uses the complete printable ASCII vocabulary and appends actual model choices", async () => {
    const network = mockSequence(["ascii_72", "ascii_105", "eos"]);
    const generator = new ChoiceGenerator(task());
    await generator.start(provider());
    expect(generator.getSnapshot().state).toBe("Hi");
    expect(generator.getSnapshot().status).toBe("completed");
    expect(network.states).toEqual(["", "H", "Hi"]);
    const first = JSON.parse(network.fetch.mock.calls[0][1].body as string);
    expect(Object.keys(first.questions.next_content.criteria)).toHaveLength(96);
  });

  it("preserves space, LF, CR, tab and backslash byte for byte", async () => {
    const value = task();
    value.vocabulary.candidates.forEach((candidate) => {
      candidate.enabled = true;
    });
    mockSequence(["ascii_32", "lf", "cr", "tab", "ascii_92", "eos"], value.vocabulary.candidates);
    const generator = new ChoiceGenerator(value);
    await generator.start(provider());
    expect(generator.getSnapshot().state).toBe(" \n\r\t\\");
    expect(JSON.parse(JSON.stringify(generator.getSnapshot())).state).toBe(" \n\r\t\\");
  });

  it("does not append an EOS protocol value", async () => {
    mockSequence(["eos"]);
    const generator = new ChoiceGenerator(task());
    await generator.start(provider());
    expect(generator.getSnapshot().state).toBe("");
    expect(generator.getSnapshot().history[0].appended).toBe("");
  });

  it.each([{}, { answers: {} }, { model: "x", answers: { next_content: { choice: "hijack" } } }])(
    "rejects malformed fields before appending",
    async (invalid) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(invalid)),
      );
      const generator = new ChoiceGenerator(task());
      await generator.start(provider());
      expect(generator.getSnapshot().status).toBe("error");
      expect(generator.getSnapshot().state).toBe("");
    },
  );

  it("rejects unknown option keys", async () => {
    mockSequence(["unknown"]);
    const generator = new ChoiceGenerator(task());
    await generator.start(provider());
    expect(generator.getSnapshot().state).toBe("");
    expect(generator.getSnapshot().history[0].status).toBe("error");
  });

  it("rejects malformed JSON without retrying", async () => {
    const network = vi.fn(async () => new Response("{bad json", { status: 200 }));
    vi.stubGlobal("fetch", network);
    const value = task();
    value.params.retries = 3;
    const generator = new ChoiceGenerator(value);
    await generator.start(provider());
    expect(network).toHaveBeenCalledTimes(1);
    expect(generator.getSnapshot().state).toBe("");
  });

  it("bounds retries and counts every actual request", async () => {
    const network = vi.fn(async () => Response.json({ detail: "Overloaded" }, { status: 529 }));
    vi.stubGlobal("fetch", network);
    const value = task();
    value.params.retries = 1;
    const generator = new ChoiceGenerator(value);
    await generator.start(provider());
    expect(network).toHaveBeenCalledTimes(2);
    expect(generator.getSnapshot().requests).toBe(2);
    expect(generator.getSnapshot().history[0].errors).toHaveLength(2);
  });

  it("does not automatically retry an ambiguous network failure by default", async () => {
    const network = vi.fn(async () => {
      throw new TypeError("contains sensitive internal information");
    });
    vi.stubGlobal("fetch", network);
    const value = task();
    value.params.retries = 3;
    const generator = new ChoiceGenerator(value);
    await generator.start(provider());
    expect(network).toHaveBeenCalledTimes(1);
    expect(generator.getSnapshot().reason).toContain("计费");
    expect(generator.getSnapshot().reason).not.toContain("sensitive");
  });

  it("stops exactly at the configured round budget", async () => {
    const network = mockSequence(Array(10).fill("ascii_97"));
    const value = task();
    value.params.maxRounds = 3;
    const generator = new ChoiceGenerator(value);
    await generator.start(provider());
    expect(generator.getSnapshot().state).toBe("aaa");
    expect(network.fetch).toHaveBeenCalledTimes(3);
    expect(generator.getSnapshot().reason).toContain("轮数");
  });

  it("discards a late result after stop, without issuing another request", async () => {
    const late = deferred<Response>();
    const network = vi.fn(() => late.promise);
    vi.stubGlobal("fetch", network);
    const generator = new ChoiceGenerator(task());
    const running = generator.start(provider());
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
    generator.stop();
    late.resolve(Response.json(answer("ascii_97")));
    await running;
    expect(generator.getSnapshot().state).toBe("");
    expect(generator.getSnapshot().status).toBe("stopped");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("pauses after the in-flight request, then resumes with the same budget", async () => {
    const late = deferred<Response>();
    const network = vi
      .fn()
      .mockImplementationOnce(() => late.promise)
      .mockResolvedValueOnce(Response.json(answer("eos")));
    vi.stubGlobal("fetch", network);
    const generator = new ChoiceGenerator(task());
    const running = generator.start(provider());
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
    generator.pause();
    late.resolve(Response.json(answer("ascii_97")));
    await running;
    expect(generator.getSnapshot().status).toBe("paused");
    expect(generator.getSnapshot().state).toBe("a");
    await generator.resume();
    expect(network).toHaveBeenCalledTimes(2);
    expect(generator.getSnapshot().runRounds).toBe(2);
  });

  it("uses manually edited State and discards the obsolete in-flight response", async () => {
    const late = deferred<Response>();
    const network = vi
      .fn()
      .mockImplementationOnce(() => late.promise)
      .mockResolvedValueOnce(Response.json(answer("eos")));
    vi.stubGlobal("fetch", network);
    const generator = new ChoiceGenerator(task());
    const running = generator.start(provider());
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
    generator.editState("manually edited\r\n\t");
    late.resolve(Response.json(answer("ascii_97")));
    await running;
    await generator.resume();
    expect(JSON.parse(network.mock.calls[1][1].body).state.generated_text).toBe(
      "manually edited\r\n\t",
    );
    expect(generator.getSnapshot().state).toBe("manually edited\r\n\t");
    expect(generator.getSnapshot().history[0].status).toBe("discarded");
  });

  it("matches stop strings spanning two choices and retains the exact text", async () => {
    const network = mockSequence(["ascii_97", "ascii_98", "ascii_99"]);
    const value = task();
    value.params.stopStrings = ["ab"];
    const generator = new ChoiceGenerator(value);
    await generator.start(provider());
    expect(network.fetch).toHaveBeenCalledTimes(2);
    expect(generator.getSnapshot().state).toBe("ab");
  });

  it("never splits a string candidate to fit the character limit", async () => {
    const value = task();
    value.params.maxChars = 2;
    value.vocabulary.mode = "string";
    value.vocabulary.candidates = [
      {
        key: "word",
        label: "Word",
        value: "hello",
        kind: "text",
        enabled: true,
        category: "custom",
      },
      value.vocabulary.candidates.at(-1)!,
    ];
    mockSequence(["word"], value.vocabulary.candidates);
    const generator = new ChoiceGenerator(value);
    await generator.start(provider());
    expect(generator.getSnapshot().state).toBe("");
    expect(generator.getSnapshot().status).toBe("completed");
  });
});
