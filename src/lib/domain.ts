import { z } from "zod";

export const MAX_OPTIONS = 255;
export const MAX_STATE_CHARS = 100_000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const generationModeSchema = z.enum(["character", "string", "token"]);
export type GenerationMode = z.infer<typeof generationModeSchema>;

export const candidateSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .refine(
      (key) => !["__proto__", "constructor", "prototype"].includes(key),
      "Reserved option key",
    ),
  label: z.string().min(1).max(100),
  value: z.string().min(1).max(2_000),
  kind: z.enum(["text", "end"]),
  category: z.string().min(1).max(60),
  enabled: z.boolean(),
});
export type Candidate = z.infer<typeof candidateSchema>;

export const vocabularySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  version: z.number().int().positive(),
  mode: generationModeSchema,
  candidates: z.array(candidateSchema).min(1).max(5_000),
});
export type Vocabulary = z.infer<typeof vocabularySchema>;

export const paramsSchema = z.object({
  maxRounds: z.number().int().min(1).max(1_000),
  maxChars: z.number().int().min(1).max(MAX_STATE_CHARS),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  retries: z.number().int().min(0).max(3),
  intervalMs: z.number().int().min(0).max(30_000),
  stopStrings: z.array(z.string().min(1).max(200)).max(20),
  retryAmbiguous: z.boolean(),
});
export type GenerationParams = z.infer<typeof paramsSchema>;
export const DEFAULT_PARAMS: GenerationParams = {
  maxRounds: 64,
  maxChars: 4_096,
  timeoutMs: 30_000,
  retries: 0,
  intervalMs: 100,
  stopStrings: [],
  retryAmbiguous: false,
};

const pathSchema = z
  .string()
  .regex(/^\/[A-Za-z0-9/_-]+$/)
  .max(200);
export const settingsSchema = z.object({
  provider: z.enum(["jev", "mock"]),
  transport: z.enum(["proxy", "direct", "public"]),
  baseUrl: z
    .string()
    .url()
    .max(500)
    .refine((value) => {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/"
      );
    }, "Base URL must be an HTTP(S) origin without a path or credentials"),
  model: z.string().min(1).max(100),
  requestPath: pathSchema,
  modelsPath: pathSchema,
  timeoutMs: z.number().int().min(1_000).max(120_000),
});
export type ModelSettings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: ModelSettings = {
  provider: "jev",
  transport: "proxy",
  baseUrl: "https://api.typesafe.ai",
  model: "jev-latest",
  requestPath: "/v1/systemone",
  modelsPath: "/v1/models",
  timeoutMs: 30_000,
};
export interface Credentials {
  token: string;
  extraHeaders: Record<string, string>;
}

export const roundSchema = z.object({
  id: z.string(),
  runId: z.string(),
  number: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  provider: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  durationMs: z.number().optional(),
  status: z.enum(["waiting", "retrying", "success", "error", "cancelled", "discarded"]),
  attempts: z.number().int().nonnegative(),
  question: z.string(),
  request: z.json(),
  response: z.json().optional(),
  optionKey: z.string().optional(),
  label: z.string().optional(),
  appended: z.string().optional(),
  confidence: z.number().optional(),
  errors: z.array(z.string()),
});
export type Round = z.infer<typeof roundSchema>;
export type JsonValue = z.infer<ReturnType<typeof z.json>>;
export const taskSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string().max(100),
  prompt: z.string().max(20_000),
  state: z.string().max(200_000),
  revision: z.number().int().nonnegative(),
  vocabulary: vocabularySchema,
  params: paramsSchema,
  history: z.array(roundSchema).max(5_000),
  status: z.enum(["idle", "running", "pausing", "paused", "stopped", "completed", "error"]),
  reason: z.string(),
  runRounds: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  runId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GenerationTask = z.infer<typeof taskSchema>;

export function createTask(vocabulary: Vocabulary): GenerationTask {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: "未命名实验",
    prompt: "",
    state: "",
    vocabulary: structuredClone(vocabulary),
    params: { ...DEFAULT_PARAMS },
    revision: 0,
    history: [],
    status: "idle",
    reason: "",
    runRounds: 0,
    requests: 0,
    runId: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function characterCount(text: string): number {
  return Array.from(text).length;
}
export function escaped(text: string): string {
  return JSON.stringify(text);
}
