import { ChoiceError } from "./provider";
import type { JsonValue } from "./domain";

export async function readJsonLimited(response: Response, limit = 1_048_576): Promise<unknown> {
  if (!response.body) throw new ChoiceError("服务返回了空响应。", "protocol");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ChoiceError("响应超过大小限制。", "response_size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch {
    throw new ChoiceError("服务返回了格式错误的 JSON。", "protocol");
  }
}

export function redact(text: string, secrets: string[]): string {
  let clean = text.replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [redacted]");
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
    clean = clean.replaceAll(secret, "[redacted]");
  return clean;
}

export function redactJson(value: JsonValue, secrets: string[]): JsonValue {
  if (typeof value === "string") return redact(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, secrets));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJson(item, secrets)]),
    );
  return value;
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal: AbortSignal,
  secrets: string[] = [],
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([signal, timeout]),
    });
    let raw: unknown;
    try {
      raw = await readJsonLimited(response);
    } catch (error) {
      if (response.ok) throw error;
      raw = undefined;
    }
    if (!response.ok) {
      const { z } = await import("zod");
      const error = z
        .object({
          error: z.string().max(2_000).optional(),
          detail: z.string().max(2_000).optional(),
          ambiguous: z.boolean().optional(),
        })
        .safeParse(raw);
      const detail = error.success ? (error.data.error ?? error.data.detail) : undefined;
      const message = redact(
        detail ? `HTTP ${response.status}：${detail}` : `模型服务返回 HTTP ${response.status}。`,
        secrets,
      ).slice(0, 500);
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      throw new ChoiceError(
        message,
        `http_${response.status}`,
        [429, 503, 529].includes(response.status),
        error.success && error.data.ambiguous === true,
        Number.isFinite(retryAfter) ? Math.min(30_000, Math.max(0, retryAfter * 1_000)) : 0,
      );
    }
    return raw;
  } catch (error) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (error instanceof ChoiceError) throw error;
    throw new ChoiceError(
      timeout.aborted ? "请求超时。" : "无法连接模型服务，请检查地址、网络和 CORS 设置。",
      "network",
      true,
      true,
    );
  }
}
