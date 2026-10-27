import { z } from "zod";
import type { Credentials, GenerationParams, ModelSettings } from "./domain";
import { fetchJson, redactJson } from "./http";
import { parseChoice, serializeChoice } from "./jev-protocol";
import { credentialsSchema } from "./model-settings";
import {
  type ChoiceInput,
  type ChoiceProvider,
  type PreparedChoice,
  ChoiceError,
} from "./provider";

const runSchema = z.object({ runId: z.string().uuid() });
const modelsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      release_date: z.string().optional(),
    }),
  ),
});

export class JevProvider implements ChoiceProvider {
  readonly id: string;
  private timeoutMs: number;
  private publicRunId?: string;
  constructor(
    private settings: ModelSettings,
    private credentials: Credentials,
  ) {
    this.id = settings.provider === "mock" ? "mock · 开发测试" : `jev · ${settings.transport}`;
    this.timeoutMs = settings.timeoutMs;
    credentialsSchema.parse(credentials);
  }
  async begin(params: GenerationParams, signal: AbortSignal) {
    this.timeoutMs = params.timeoutMs;
    if (
      this.settings.transport === "public" &&
      this.settings.provider !== "mock" &&
      !this.publicRunId
    ) {
      const raw = await fetchJson(
        "/api/public/runs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        },
        10_000,
        signal,
      );
      this.publicRunId = runSchema.parse(raw).runId;
    }
  }
  prepare(input: ChoiceInput): PreparedChoice {
    return serializeChoice(input, this.settings.model);
  }
  async choose(request: PreparedChoice, signal: AbortSignal) {
    const direct = this.settings.transport === "direct" && this.settings.provider !== "mock";
    if (direct && !this.credentials.token)
      throw new ChoiceError("请先填写 API Token。", "credentials");
    const url =
      this.settings.provider === "mock"
        ? "/api/development/mock"
        : direct
          ? `${this.settings.baseUrl}${this.settings.requestPath}`
          : "/api/choice";
    const headers = direct
      ? {
          ...this.credentials.extraHeaders,
          Authorization: `Bearer ${this.credentials.token}`,
          "Content-Type": "application/json",
        }
      : { "Content-Type": "application/json" };
    const body = direct
      ? request.wire
      : {
          settings: this.settings,
          credentials: this.settings.transport === "public" ? undefined : this.credentials,
          input: request.input,
          timeoutMs: this.timeoutMs,
          publicRunId: this.publicRunId,
        };
    const raw = await fetchJson(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      this.timeoutMs + (direct ? 0 : 2_000),
      signal,
      [this.credentials.token, ...Object.values(this.credentials.extraHeaders)],
    );
    const result = parseChoice(raw, request);
    return {
      ...result,
      response: redactJson(result.response, [
        this.credentials.token,
        ...Object.values(this.credentials.extraHeaders),
      ]),
    };
  }
}

export async function testConnection(
  settings: ModelSettings,
  credentials: Credentials,
  signal: AbortSignal,
): Promise<string[]> {
  if (settings.provider === "mock") return ["MOCK · 开发测试，不调用真实模型"];
  const direct = settings.transport === "direct";
  const raw = await fetchJson(
    direct ? `${settings.baseUrl}${settings.modelsPath}` : "/api/connection",
    {
      method: direct ? "GET" : "POST",
      headers: direct
        ? { ...credentials.extraHeaders, Authorization: `Bearer ${credentials.token}` }
        : { "Content-Type": "application/json" },
      body: direct
        ? undefined
        : JSON.stringify({
            settings,
            credentials: settings.transport === "public" ? undefined : credentials,
          }),
    },
    settings.timeoutMs,
    signal,
    [credentials.token, ...Object.values(credentials.extraHeaders)],
  );
  const result = modelsSchema.safeParse(raw);
  if (!result.success) throw new ChoiceError("模型列表响应缺少 models[].name。", "protocol");
  if (!result.data.models.some((model) => model.name === settings.model))
    throw new ChoiceError("连接成功，但模型列表中找不到设置的模型标识符。", "model");
  return result.data.models.map((model) => model.name);
}
