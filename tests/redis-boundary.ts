import { LuaFactory } from "wasmoon";
import type { RedisBoundary } from "@/server/rate-limiter";

// Only the external Redis command boundary is replaced. Production Lua scripts run unchanged.
export class LuaRedisBoundary implements RedisBoundary {
  private hashes = new Map<string, Map<string, string>>();
  private strings = new Map<string, string>();
  private sets = new Map<string, Map<string, number>>();
  private expires = new Map<string, number>();
  private engine = new LuaFactory().createEngine();
  private queue: Promise<unknown> = Promise.resolve();

  private remove(key: string) {
    this.hashes.delete(key);
    this.strings.delete(key);
    this.sets.delete(key);
    this.expires.delete(key);
  }
  private call = (name: string, ...raw: (string | number)[]): string | number | boolean => {
    const args = raw.map(String);
    const key = args[0];
    if ((this.expires.get(key) ?? Infinity) <= Date.now()) this.remove(key);
    const hash = () => {
      if (!this.hashes.has(key)) this.hashes.set(key, new Map());
      return this.hashes.get(key)!;
    };
    const sorted = () => {
      if (!this.sets.has(key)) this.sets.set(key, new Map());
      return this.sets.get(key)!;
    };
    switch (name.toUpperCase()) {
      case "HGET":
        return this.hashes.get(key)?.get(args[1]) ?? false;
      case "HSET":
        for (let index = 1; index < args.length; index += 2)
          hash().set(args[index], args[index + 1]);
        return 1;
      case "HINCRBY": {
        const value = Number(hash().get(args[1]) ?? 0) + Number(args[2]);
        hash().set(args[1], String(value));
        return value;
      }
      case "GET":
        return this.strings.get(key) ?? false;
      case "SET":
        this.strings.set(key, args[1]);
        if (args[2] === "PX") this.expires.set(key, Date.now() + Number(args[3]));
        return "OK";
      case "INCR": {
        const value = Number(this.strings.get(key) ?? 0) + 1;
        this.strings.set(key, String(value));
        return value;
      }
      case "EXISTS":
        return Number(this.strings.has(key) || this.hashes.has(key) || this.sets.has(key));
      case "PEXPIRE":
        this.expires.set(key, Date.now() + Number(args[1]));
        return 1;
      case "EXPIRE":
        this.expires.set(key, Date.now() + Number(args[1]) * 1_000);
        return 1;
      case "DEL":
        this.remove(key);
        return 1;
      case "ZADD":
        sorted().set(args[2], Number(args[1]));
        return 1;
      case "ZREM":
        return Number(sorted().delete(args[1]));
      case "ZCARD":
        return sorted().size;
      case "ZREMRANGEBYSCORE": {
        let removed = 0;
        for (const [member, score] of sorted())
          if (score <= Number(args[2])) {
            sorted().delete(member);
            removed++;
          }
        return removed;
      }
      default:
        throw new Error(`Redis boundary command is not implemented: ${name}`);
    }
  };
  async eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T> {
    const execute = this.queue.then(async () => {
      const engine = await this.engine;
      engine.global.set("redis", { call: this.call });
      engine.global.set("KEYS", keys);
      engine.global.set("ARGV", args.map(String));
      const result: unknown = await engine.doString(script);
      return result;
    });
    this.queue = execute.catch(() => undefined);
    return (await execute) as T;
  }
  async close() {
    (await this.engine).global.close();
  }
}
