import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { ChoiceError } from "@/lib/provider";
import type { ServerConfig } from "./config";

export class ApiError extends ChoiceError {
  constructor(
    public readonly status: number,
    code: string,
    message: string,
    ambiguous = false,
  ) {
    super(message, code, false, ambiguous);
  }
}
export function clientKey(request: Request, config: ServerConfig): string {
  let ip = "shared-unidentified";
  if (config.JEV_IP_MODE === "trusted-proxy") {
    const received = Buffer.from(request.headers.get("x-jev-proxy-secret") ?? "");
    const expected = Buffer.from(config.JEV_TRUSTED_PROXY_SECRET);
    if (
      expected.length < 32 ||
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new ApiError(403, "proxy_trust", "可信代理校验失败。");
    }
    const candidate = request.headers.get(config.JEV_CLIENT_IP_HEADER) ?? "";
    if (!isIP(candidate)) throw new ApiError(400, "client_ip", "可信代理没有提供单一有效 IP。");
    ip = candidate.toLowerCase();
  }
  return createHmac("sha256", config.JEV_LIMITER_SECRET || "byok-shared-bucket")
    .update(ip)
    .digest("hex");
}
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const target = new URL(request.url);
  // NextURL normalizes loopback hosts and standalone servers use an internal hostname.
  // Host preserves the browser's target authority; never use X-Forwarded-Host here.
  const authority = request.headers.get("host")?.toLowerCase() ?? target.host;
  let source: URL | undefined;
  try {
    source = origin ? new URL(origin) : undefined;
  } catch {
    throw new ApiError(403, "origin", "请求必须来自本站。");
  }
  if (
    !source ||
    origin !== source.origin ||
    source.host !== authority ||
    source.protocol !== target.protocol
  )
    throw new ApiError(403, "origin", "请求必须来自本站。");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "content_type", "请发送 application/json。");
  }
}
export async function readBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes)
    throw new ApiError(413, "body_size", "请求体超过大小限制。");
  if (!request.body) throw new ApiError(400, "body", "请求体为空。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "body_size", "请求体超过大小限制。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new ApiError(400, "json", "请求体不是有效 JSON。");
  }
}
export function validateTarget(baseUrl: string, path: string, config: ServerConfig): string {
  const base = new URL(baseUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    !/^\/[A-Za-z0-9/_-]+$/.test(path)
  ) {
    throw new ApiError(400, "target", "API 地址格式不正确。");
  }
  if (!config.allowedOrigins.includes(base.origin))
    throw new ApiError(
      403,
      "target",
      "代理没有允许这个 API origin，请由管理员配置或改用浏览器直连。",
    );
  if (
    base.protocol !== "https:" &&
    !(base.protocol === "http:" && config.JEV_ALLOW_HTTP_UPSTREAM === "true")
  ) {
    throw new ApiError(403, "target", "代理默认只接受 HTTPS 上游。");
  }
  return new URL(path, base.origin).href;
}
export function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
export function audit(
  event: "api_rejected" | "upstream_failed" | "storage_unavailable",
  status: number,
) {
  console.warn(JSON.stringify({ event, status, time: new Date().toISOString() }));
}
export async function apiBoundary(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ApiError) {
      audit("api_rejected", error.status);
      return jsonResponse(
        { error: error.message, code: error.code, ambiguous: error.ambiguous },
        error.status,
      );
    }
    if (error instanceof z.ZodError) {
      audit("api_rejected", 400);
      return jsonResponse(
        { error: "配置缺少必要字段，或字段超过允许范围。", code: "validation" },
        400,
      );
    }
    if (error instanceof ChoiceError) {
      const status = error.retryable
        ? error.code.startsWith("http_")
          ? Number(error.code.slice(5))
          : 504
        : 502;
      audit("upstream_failed", status);
      return jsonResponse(
        { error: error.message, code: error.code, ambiguous: error.ambiguous },
        status,
      );
    }
    audit("storage_unavailable", 503);
    return jsonResponse(
      { error: "服务暂时不可用，请检查服务端配置和共享限流存储。", code: "unavailable" },
      503,
    );
  }
}
