import { describe, expect, it } from "vitest";
import { serializeChoice, parseChoice } from "@/lib/jev-protocol";
import {
  asciiVocabulary,
  batchCandidates,
  importVocabulary,
  validateVocabulary,
} from "@/lib/vocabulary";
import { answer } from "./helpers";

describe("confirmed TypeSafe v1 protocol", () => {
  const input = {
    prompt: "Continue",
    state: "a\n",
    candidates: asciiVocabulary().candidates.filter((candidate) => candidate.enabled),
    mode: "character",
    requestId: "test",
    round: 1,
  };
  it("separates keys, labels and verbatim values", () => {
    const item = {
      key: "different_key",
      label: "Space",
      value: " ",
      kind: "text" as const,
      enabled: true,
      category: "test",
    };
    const prepared = serializeChoice(
      { ...input, candidates: [item, input.candidates.at(-1)!] },
      "jev-latest",
    );
    const body = JSON.parse(JSON.stringify(prepared.wire));
    expect(body.questions.next_content.criteria.different_key).toEqual({
      action: "append",
      value: " ",
    });
    expect(body.state.generated_text).toBe("a\n");
    expect(body.questions.next_content.option).toBeUndefined();
  });
  it("parses actual Choice response fields", () => {
    const parsed = parseChoice(answer("ascii_97"), serializeChoice(input, "jev-latest"));
    expect(parsed.key).toBe("ascii_97");
    expect(parsed.usage.input_tokens).toBe(40);
  });
  it("rejects invalid probability distributions", () => {
    const raw = answer("ascii_97");
    raw.answers.next_content.probabilities.ascii_97 = 0;
    expect(() => parseChoice(raw, serializeChoice(input, "jev-latest"))).toThrow("sum");
  });
  it("does not recognize an empty response as EOS", () => {
    expect(() => parseChoice(null, serializeChoice(input, "jev-latest"))).toThrow();
  });
});

describe("vocabularies", () => {
  it("includes all 95 printable ASCII code points and optional controls", () => {
    const vocabulary = asciiVocabulary();
    expect(
      vocabulary.candidates
        .filter((candidate) => candidate.enabled && candidate.kind === "text")
        .map((candidate) => candidate.value),
    ).toEqual(Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)));
    expect(vocabulary.candidates.find((candidate) => candidate.key === "lf")?.enabled).toBe(false);
  });
  it("round-trips custom keys, whitespace and EOS mappings in JSON", () => {
    const vocabulary = asciiVocabulary();
    vocabulary.name = "My custom vocabulary";
    vocabulary.candidates.at(-1)!.value = "<DONE>";
    expect(importVocabulary(JSON.stringify(vocabulary))).toEqual(vocabulary);
  });
  it("validates duplicate keys and empty values", () => {
    const vocabulary = asciiVocabulary();
    vocabulary.candidates[1].key = vocabulary.candidates[0].key;
    expect(validateVocabulary(vocabulary).join()).toContain("重复");
    vocabulary.candidates[0].value = "";
    expect(validateVocabulary(vocabulary).length).toBeGreaterThan(0);
  });
  it("rejects oversized active lists without sampling", () => {
    const vocabulary = asciiVocabulary();
    vocabulary.mode = "string";
    vocabulary.candidates = Array.from({ length: 256 }, (_, index) => ({
      key: `k${index}`,
      label: `Item ${index}`,
      value: `v${index}`,
      kind: "text",
      enabled: true,
      category: "test",
    }));
    expect(validateVocabulary(vocabulary).join()).toContain("256");
    expect(vocabulary.candidates).toHaveLength(256);
  });
  it("interprets escapes only when explicitly requested", () => {
    expect(batchCandidates("\\n\n\\t", false).map((item) => item.value)).toEqual(["\\n", "\\t"]);
    expect(batchCandidates("\\n\n\\t", true).map((item) => item.value)).toEqual(["\n", "\t"]);
  });
});
