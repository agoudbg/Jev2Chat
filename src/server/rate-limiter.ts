import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { GenerationParams, JsonValue } from "@/lib/domain";
import type { ServerConfig } from "./config";
import { ApiError } from "./security";

export interface RedisBoundary {
  eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T>;
}
// Every admission check and counter update runs in one Redis transaction.
export const ADMIT_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local owner = redis.call('HGET', KEYS[2], 'owner')
if not owner or owner ~= ARGV[4] then return {'run'} end
local cached = redis.call('HGET', KEYS[1], 'response')
local oldHash = redis.call('HGET', KEYS[1], 'hash')
if oldHash and oldHash ~= ARGV[3] then return {'conflict'} end
if cached then return {'cached', cached} end
if tonumber(ARGV[5]) > tonumber(redis.call('HGET', KEYS[2], 'rounds')) then return {'rounds'} end
if redis.call('EXISTS', KEYS[3]) == 1 then return {'busy'} end
if tonumber(redis.call('HGET', KEYS[1], 'attempts') or '0') >= tonumber(redis.call('HGET', KEYS[2], 'attempts')) then return {'attempts'} end
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now)
if redis.call('ZCARD', KEYS[4]) >= tonumber(ARGV[6]) or redis.call('ZCARD', KEYS[5]) >= tonumber(ARGV[7]) then return {'concurrency'} end
local rate = tonumber(redis.call('GET', KEYS[6]) or '0')
if rate >= tonumber(ARGV[8]) then return {'rate'} end
local daily = tonumber(redis.call('GET', KEYS[7]) or '0')
if daily >= tonumber(ARGV[9]) then return {'daily'} end
redis.call('INCR', KEYS[6])
redis.call('PEXPIRE', KEYS[6], window)
redis.call('INCR', KEYS[7])
redis.call('EXPIRE', KEYS[7], 172800)
redis.call('HSET', KEYS[1], 'hash', ARGV[3])
redis.call('HINCRBY', KEYS[1], 'attempts', 1)
redis.call('EXPIRE', KEYS[1], 3600)
redis.call('SET', KEYS[3], ARGV[10], 'PX', ARGV[11])
redis.call('ZADD', KEYS[4], now + tonumber(ARGV[11]), ARGV[10])
redis.call('ZADD', KEYS[5], now + tonumber(ARGV[11]), ARGV[10])
redis.call('PEXPIRE', KEYS[4], ARGV[11])
redis.call('PEXPIRE', KEYS[5], ARGV[11])
return {'ok'}
`;
export const FINISH_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  if ARGV[2] ~= '' then redis.call('HSET', KEYS[2], 'response', ARGV[2]) end
  redis.call('DEL', KEYS[1])
end
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
return 1
`;
export const CREATE_RUN_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('HSET', KEYS[2], 'owner', ARGV[3], 'rounds', ARGV[4], 'attempts', ARGV[5])
redis.call('EXPIRE', KEYS[2], 3600)
return 1
`;
export const SIMPLE_LIMIT_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

export class RateLimiter {
  constructor(
    private redis: RedisBoundary,
    private config: ServerConfig,
  ) {}
  async createRun(client: string, params: GenerationParams): Promise<string> {
    if (
      params.maxRounds > this.config.JEV_PUBLIC_MAX_ROUNDS ||
      params.retries > this.config.JEV_PUBLIC_MAX_RETRIES
    ) {
      throw new ApiError(400, "run_limit", "生成轮数或重试次数超过公共服务上限。");
    }
    const runId = randomUUID();
    const accepted = await this.redis.eval<number>(
      CREATE_RUN_SCRIPT,
      [`jev:runs:${client}`, `jev:run:${runId}`],
      [
        this.config.JEV_RUNS_PER_WINDOW,
        this.config.JEV_RATE_WINDOW_SECONDS,
        client,
        params.maxRounds,
        params.retries + 1,
      ],
    );
    if (accepted !== 1) throw new ApiError(429, "run_rate", "创建任务过于频繁，请稍后再试。");
    return runId;
  }
  async connection(client: string) {
    const accepted = await this.redis.eval<number>(
      SIMPLE_LIMIT_SCRIPT,
      [`jev:connection:${client}`],
      [5, 60],
    );
    if (accepted !== 1)
      throw new ApiError(429, "connection_rate", "连接测试过于频繁，请稍后再试。");
  }
  async acquire(client: string, runId: string, round: number, hash: string) {
    const lease = randomUUID();
    const entry = `jev:answer:${runId}:${round}`;
    const lock = `jev:lock:${runId}:${round}`;
    const globalActive = "jev:active:global";
    const ipActive = `jev:active:${client}`;
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const reply = await this.redis.eval<string[]>(
      ADMIT_SCRIPT,
      [
        entry,
        `jev:run:${runId}`,
        lock,
        globalActive,
        ipActive,
        `jev:rate:${client}`,
        `jev:daily:${day}`,
      ],
      [
        now,
        this.config.JEV_RATE_WINDOW_SECONDS * 1_000,
        hash,
        client,
        round,
        this.config.JEV_GLOBAL_CONCURRENCY,
        this.config.JEV_IP_CONCURRENCY,
        this.config.JEV_RATE_REQUESTS,
        this.config.JEV_GLOBAL_DAILY_REQUESTS,
        lease,
        this.config.JEV_UPSTREAM_TIMEOUT_MS + 10_000,
      ],
    );
    const result = z.array(z.string()).parse(reply);
    if (result[0] === "cached")
      return { cached: JSON.parse(result[1]) as JsonValue, release: async () => {} };
    if (result[0] !== "ok") {
      const code = result[0];
      const message =
        code === "conflict"
          ? "这个轮次已经绑定了不同的 State，请开始新一轮。"
          : code === "run"
            ? "公共运行已过期或不属于这个客户端，请从当前 State 重新开始。"
            : code === "daily"
              ? "公共服务今天的请求额度已经用完。"
              : code === "rounds" || code === "attempts"
                ? "这个运行已经达到轮数或重试上限。"
                : code === "busy"
                  ? "这个轮次还有请求在处理，请稍后重试。"
                  : "公共服务达到频率或并发上限，请稍后再试。";
      throw new ApiError(
        ["conflict", "busy"].includes(code) ? 409 : code === "run" ? 403 : 429,
        `limit_${code}`,
        message,
      );
    }
    return {
      cached: undefined,
      release: async (response?: JsonValue) => {
        await this.redis.eval<number>(
          FINISH_SCRIPT,
          [lock, entry, globalActive, ipActive],
          [lease, response ? JSON.stringify(response) : ""],
        );
      },
    };
  }
}

export function rateLimiter(config: ServerConfig): RateLimiter {
  if (!config.publicReady)
    throw new ApiError(503, "public_disabled", "公共服务没有启用或配置不完整。");
  const redis = new Redis({
    url: config.UPSTASH_REDIS_REST_URL,
    token: config.UPSTASH_REDIS_REST_TOKEN,
    automaticDeserialization: false,
    retry: { retries: 0 },
  });
  return new RateLimiter(redis, config);
}

// BYOK limits protect one process; shared Redis enforcement is mandatory for public credentials.
const byokBuckets = new Map<string, { expires: number; count: number; active: number }>();
export function acquireByok(client: string): () => void {
  const now = Date.now();
  for (const [key, value] of byokBuckets)
    if (value.expires < now && value.active === 0) byokBuckets.delete(key);
  const bucket = byokBuckets.get(client) ?? { expires: now + 60_000, count: 0, active: 0 };
  if (bucket.expires < now) {
    bucket.count = 0;
    bucket.expires = now + 60_000;
  }
  if (bucket.count >= 120 || bucket.active >= 8 || byokBuckets.size >= 2_000)
    throw new ApiError(429, "byok_rate", "代理达到频率或并发上限，请稍后再试。");
  bucket.count++;
  bucket.active++;
  byokBuckets.set(client, bucket);
  return () => {
    bucket.active--;
  };
}
