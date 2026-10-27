import {
  candidateSchema,
  MAX_OPTIONS,
  type Candidate,
  type Vocabulary,
  vocabularySchema,
} from "./domain";

export function asciiVocabulary(): Vocabulary {
  const candidates: Candidate[] = Array.from({ length: 95 }, (_, index) => {
    const code = index + 32;
    const value = String.fromCodePoint(code);
    const category = /[a-z]/.test(value)
      ? "小写字母"
      : /[A-Z]/.test(value)
        ? "大写字母"
        : /[0-9]/.test(value)
          ? "数字"
          : "符号与空格";
    return {
      key: `ascii_${code}`,
      label: value === " " ? "Space" : value,
      value,
      category,
      enabled: true,
      kind: "text",
    };
  });
  candidates.push(
    {
      key: "lf",
      label: "LF · \\n",
      value: "\n",
      category: "控制字符",
      enabled: false,
      kind: "text",
    },
    {
      key: "cr",
      label: "CR · \\r",
      value: "\r",
      category: "控制字符",
      enabled: false,
      kind: "text",
    },
    {
      key: "tab",
      label: "Tab · \\t",
      value: "\t",
      category: "控制字符",
      enabled: false,
      kind: "text",
    },
    { key: "eos", label: "EOS", value: "EOS", category: "结束标记", enabled: true, kind: "end" },
  );
  return { id: "ascii", name: "ASCII · 可打印字符", version: 1, mode: "character", candidates };
}

export function validateVocabulary(vocabulary: Vocabulary): string[] {
  const parsed = vocabularySchema.safeParse(vocabulary);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const errors: string[] = [];
  const keys = new Set<string>();
  const values = new Set<string>();
  for (const candidate of vocabulary.candidates) {
    if (keys.has(candidate.key)) errors.push(`重复 option key：${candidate.key}`);
    keys.add(candidate.key);
    if (!candidate.enabled) continue;
    const identity = `${candidate.kind}:${candidate.value}`;
    if (values.has(identity)) errors.push(`重复候选值：${JSON.stringify(candidate.value)}`);
    values.add(identity);
    if (
      vocabulary.mode === "character" &&
      candidate.kind === "text" &&
      Array.from(candidate.value).length !== 1
    ) {
      errors.push(`字符模式每项只能有一个 Unicode 码点：${candidate.key}`);
    }
  }
  const count = vocabulary.candidates.filter((candidate) => candidate.enabled).length;
  if (count < 2) errors.push("至少启用 2 个候选项。");
  if (count > MAX_OPTIONS)
    errors.push(`启用了 ${count} 项，Jev 每次最多支持 ${MAX_OPTIONS} 项。请明确禁用部分选项。`);
  return errors;
}

export function importVocabulary(text: string): Vocabulary {
  const vocabulary = vocabularySchema.parse(JSON.parse(text));
  const errors = validateVocabulary(vocabulary);
  if (errors.length) throw new Error(errors.join("\n"));
  return vocabulary;
}

export function batchCandidates(text: string, interpretEscapes: boolean): Candidate[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const value: unknown = interpretEscapes ? JSON.parse(`"${line}"`) : line;
      if (typeof value !== "string") throw new Error("候选值必须是字符串。");
      return candidateSchema.parse({
        key: `item_${crypto.randomUUID().replaceAll("-", "")}`,
        label: line,
        value,
        kind: "text",
        category: "自定义",
        enabled: true,
      });
    });
}
