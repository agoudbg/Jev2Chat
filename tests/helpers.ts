import { vi } from "vitest";
import { createTask, DEFAULT_SETTINGS, type Candidate } from "@/lib/domain";
import { JevProvider } from "@/lib/jev-provider";
import { QUESTION_ID } from "@/lib/jev-protocol";
import { asciiVocabulary } from "@/lib/vocabulary";

export function task() {
  const value = createTask(asciiVocabulary());
  value.prompt = "Write a short greeting.";
  value.params = { ...value.params, maxRounds: 10, intervalMs: 0 };
  return value;
}
export function provider() {
  return new JevProvider(
    { ...DEFAULT_SETTINGS, transport: "direct" },
    { token: "test-only-secret", extraHeaders: {} },
  );
}
export function answer(
  key: string,
  candidates = asciiVocabulary().candidates.filter((candidate) => candidate.enabled),
) {
  return {
    model: "jev-test",
    answers: {
      [QUESTION_ID]: {
        type: "choice",
        choice: key,
        confidence: 0.95,
        probabilities: Object.fromEntries(
          candidates.map((candidate) => [candidate.key, candidate.key === key ? 1 : 0]),
        ),
      },
    },
    usage: { input_tokens: 40, output_tokens: 20 },
  };
}
export function mockSequence(keys: string[], candidates?: Candidate[]) {
  const states: string[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    states.push(request.state.generated_text);
    return Response.json(answer(keys[states.length - 1] ?? "eos", candidates));
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, states };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
