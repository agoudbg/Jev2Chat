import { z } from "zod";
import { DEFAULT_SETTINGS } from "@/lib/domain";

const int = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const envSchema = z.object({
  JEV_PUBLIC_ENABLED: z.enum(["true", "false"]).default("false"),
  JEV_PUBLIC_TOKEN: z.string().default(""),
  JEV_PUBLIC_MODEL: z.string().default("jev-latest"),
  JEV_PUBLIC_BASE_URL: z.string().url().default("https://api.typesafe.ai"),
  JEV_ALLOWED_API_ORIGINS: z.string().default("https://api.typesafe.ai"),
  JEV_ALLOW_HTTP_UPSTREAM: z.enum(["true", "false"]).default("false"),
  JEV_PUBLIC_MAX_ROUNDS: int(64, 1, 1_000),
  JEV_PUBLIC_MAX_RETRIES: int(1, 0, 3),
  JEV_PUBLIC_MAX_INPUT_CHARS: int(16_000, 100, 100_000),
  JEV_BODY_MAX_BYTES: int(262_144, 16_384, 1_048_576),
  JEV_UPSTREAM_TIMEOUT_MS: int(30_000, 1_000, 60_000),
  JEV_RATE_WINDOW_SECONDS: int(60, 1, 3_600),
  JEV_RATE_REQUESTS: int(30, 1, 10_000),
  JEV_RUNS_PER_WINDOW: int(5, 1, 100),
  JEV_GLOBAL_DAILY_REQUESTS: int(1_000, 1, 1_000_000),
  JEV_GLOBAL_CONCURRENCY: int(8, 1, 100),
  JEV_IP_CONCURRENCY: int(1, 1, 10),
  JEV_IP_MODE: z.enum(["shared", "trusted-proxy"]).default("shared"),
  JEV_CLIENT_IP_HEADER: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("x-real-ip"),
  JEV_TRUSTED_PROXY_SECRET: z.string().default(""),
  JEV_LIMITER_SECRET: z.string().default(""),
  UPSTASH_REDIS_REST_URL: z.string().default(""),
  UPSTASH_REDIS_REST_TOKEN: z.string().default(""),
});

export function serverConfig(env: Record<string, string | undefined> = process.env) {
  const value = envSchema.parse(env);
  const ready =
    value.JEV_PUBLIC_ENABLED === "true" &&
    Boolean(value.JEV_PUBLIC_TOKEN) &&
    value.JEV_LIMITER_SECRET.length >= 32 &&
    Boolean(value.UPSTASH_REDIS_REST_URL && value.UPSTASH_REDIS_REST_TOKEN) &&
    (value.JEV_IP_MODE === "shared" || value.JEV_TRUSTED_PROXY_SECRET.length >= 32);
  return {
    ...value,
    publicReady: ready,
    allowedOrigins: value.JEV_ALLOWED_API_ORIGINS.split(",").map(
      (origin) => new URL(origin.trim()).origin,
    ),
  };
}
export type ServerConfig = ReturnType<typeof serverConfig>;

export function clientConfig(config = serverConfig()) {
  return {
    publicEnabled: config.publicReady,
    publicModel: config.JEV_PUBLIC_MODEL,
    publicMaxRounds: config.JEV_PUBLIC_MAX_ROUNDS,
    publicMaxRetries: config.JEV_PUBLIC_MAX_RETRIES,
    rateRequests: config.JEV_RATE_REQUESTS,
    rateWindowSeconds: config.JEV_RATE_WINDOW_SECONDS,
    ipConcurrency: config.JEV_IP_CONCURRENCY,
    dailyRequests: config.JEV_GLOBAL_DAILY_REQUESTS,
    ipMode: config.JEV_IP_MODE,
    bodyMaxBytes: config.JEV_BODY_MAX_BYTES,
    mockEnabled: process.env.NODE_ENV === "development",
    defaultSettings: DEFAULT_SETTINGS,
  };
}
