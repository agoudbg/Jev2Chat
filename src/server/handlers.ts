import { createHash } from "node:crypto";
import { z } from "zod";
import { candidateSchema, characterCount, paramsSchema, settingsSchema } from "@/lib/domain";
import { fetchJson, redactJson } from "@/lib/http";
import { parseChoice, serializeChoice } from "@/lib/jev-protocol";
import { credentialsSchema } from "@/lib/model-settings";
import { ChoiceError } from "@/lib/provider";
import { validateVocabulary } from "@/lib/vocabulary";
import { serverConfig, type ServerConfig } from "./config";
import { acquireByok, rateLimiter, type RateLimiter } from "./rate-limiter";
import {
  ApiError,
  apiBoundary,
  clientKey,
  jsonResponse,
  readBody,
  requireSameOrigin,
  validateTarget,
} from "./security";

const connectionSchema = z.object({
  settings: settingsSchema,
  credentials: credentialsSchema.optional(),
});
export const choicePayloadSchema = connectionSchema.extend({
  input: z.object({
    prompt: z.string().min(1).max(20_000),
    state: z.string().max(200_000),
    candidates: z.array(candidateSchema).min(2).max(255),
    round: z.number().int().min(1).max(1_000),
    requestId: z.string().regex(/^[a-f0-9-]{36}:[0-9]{1,4}$/),
    mode: z.enum(["character", "string", "token"]),
  }),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  publicRunId: z.string().uuid().optional(),
});
interface Dependencies {
  config?: ServerConfig;
  limiter?: RateLimiter;
}

function connection(payload: z.infer<typeof connectionSchema>, config: ServerConfig) {
  if (payload.settings.transport === "public") {
    if (!config.publicReady) throw new ApiError(503, "public_disabled", "公共服务没有启用。");
    if (payload.settings.model !== config.JEV_PUBLIC_MODEL)
      throw new ApiError(409, "public_config_changed", "公共模型配置已变化，请刷新页面后重试。");
    return {
      baseUrl: config.JEV_PUBLIC_BASE_URL,
      model: config.JEV_PUBLIC_MODEL,
      requestPath: "/v1/systemone",
      modelsPath: "/v1/models",
      token: config.JEV_PUBLIC_TOKEN,
      extraHeaders: {},
    };
  }
  if (payload.settings.transport !== "proxy" || payload.settings.provider !== "jev")
    throw new ApiError(400, "transport", "这个 API 只接受 Jev 代理请求。");
  if (!payload.credentials?.token) throw new ApiError(400, "credentials", "请提供 API Token。");
  return { ...payload.settings, ...payload.credentials };
}

export function handleChoice(request: Request, dependencies: Dependencies = {}) {
  return apiBoundary(async () => {
    requireSameOrigin(request);
    const config = dependencies.config ?? serverConfig();
    const payload = choicePayloadSchema.parse(await readBody(request, config.JEV_BODY_MAX_BYTES));
    const target = connection(payload, config);
    const errors = validateVocabulary({
      id: "request",
      name: "request",
      version: 1,
      mode: payload.input.mode,
      candidates: payload.input.candidates,
    });
    if (errors.length || payload.input.candidates.some((candidate) => !candidate.enabled))
      throw new ApiError(400, "vocabulary", "词表无效或包含禁用项。");
    const url = validateTarget(target.baseUrl, target.requestPath, config);
    const prepared = serializeChoice(payload.input, target.model);
    const isPublic = payload.settings.transport === "public";
    const client = clientKey(request, config);
    if (
      isPublic &&
      characterCount(payload.input.prompt) + characterCount(payload.input.state) >
        config.JEV_PUBLIC_MAX_INPUT_CHARS
    ) {
      throw new ApiError(413, "context_size", "提示词和 State 超过公共服务的输入长度上限。");
    }
    const limiter = isPublic ? (dependencies.limiter ?? rateLimiter(config)) : undefined;
    if (isPublic && !payload.publicRunId) throw new ApiError(400, "run", "缺少公共运行标识符。");
    const admitted =
      limiter && payload.publicRunId
        ? await limiter.acquire(
            client,
            payload.publicRunId,
            payload.input.round,
            createHash("sha256").update(JSON.stringify(prepared.wire)).digest("hex"),
          )
        : undefined;
    if (admitted?.cached) return jsonResponse(admitted.cached);
    const releaseByok = isPublic ? undefined : acquireByok(client);
    let successful: ReturnType<typeof parseChoice>["response"] | undefined;
    try {
      const raw = await fetchJson(
        url,
        {
          method: "POST",
          headers: {
            ...target.extraHeaders,
            Authorization: `Bearer ${target.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(prepared.wire),
        },
        Math.min(payload.timeoutMs, config.JEV_UPSTREAM_TIMEOUT_MS),
        request.signal,
        [target.token, ...Object.values(target.extraHeaders)],
      );
      const result = parseChoice(raw, prepared);
      // Project known fields and redact credentials even if an upstream reflects them.
      successful = redactJson(result.response, [
        target.token,
        ...Object.values(target.extraHeaders),
      ]);
      return jsonResponse(successful);
    } finally {
      releaseByok?.();
      if (admitted) {
        try {
          await admitted.release(successful);
        } catch {
          throw new ApiError(
            503,
            "finalize",
            successful
              ? "模型已经返回，但请求去重结果没有保存成功。"
              : "请求结果没有确认，去重存储也暂时不可用。",
            true,
          );
        }
      }
    }
  });
}

export function handleConnection(request: Request, dependencies: Dependencies = {}) {
  return apiBoundary(async () => {
    requireSameOrigin(request);
    const config = dependencies.config ?? serverConfig();
    const payload = connectionSchema.parse(await readBody(request, 16_384));
    const target = connection(payload, config);
    const client = clientKey(request, config);
    if (payload.settings.transport === "public")
      await (dependencies.limiter ?? rateLimiter(config)).connection(client);
    const release = acquireByok(client);
    try {
      const url = validateTarget(target.baseUrl, target.modelsPath, config);
      const raw = await fetchJson(
        url,
        { headers: { ...target.extraHeaders, Authorization: `Bearer ${target.token}` } },
        Math.min(payload.settings.timeoutMs, config.JEV_UPSTREAM_TIMEOUT_MS),
        request.signal,
        [target.token, ...Object.values(target.extraHeaders)],
      );
      const parsed = z
        .object({ models: z.array(z.object({ name: z.string().min(1).max(200) })).max(500) })
        .safeParse(raw);
      if (!parsed.success) throw new ChoiceError("上游模型列表格式不正确。", "protocol");
      return jsonResponse(
        redactJson(parsed.data, [target.token, ...Object.values(target.extraHeaders)]),
      );
    } finally {
      release();
    }
  });
}

export function handlePublicRun(request: Request, dependencies: Dependencies = {}) {
  return apiBoundary(async () => {
    requireSameOrigin(request);
    const config = dependencies.config ?? serverConfig();
    const params = paramsSchema.parse(await readBody(request, 4_096));
    const limiter = dependencies.limiter ?? rateLimiter(config);
    return jsonResponse({
      runId: await limiter.createRun(clientKey(request, config), params),
      expiresInSeconds: 3_600,
    });
  });
}
