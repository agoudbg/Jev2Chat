"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { CheckCircle2, LoaderCircle, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  DEFAULT_SETTINGS,
  settingsSchema,
  type Credentials,
  type ModelSettings,
} from "@/lib/domain";
import { connectionIdentity, credentialsSchema, headersSchema } from "@/lib/model-settings";
import { testConnection } from "@/lib/jev-provider";
import type { ClientConfig } from "@/lib/client-config";
import { NumberField, Selection } from "./controls";

export interface SavedConnection {
  settings: ModelSettings;
  credentials: Credentials;
  saveSecrets: boolean;
  tested: boolean;
}
export function SettingsPanel({
  settings,
  credentials,
  saved,
  config,
  onClose,
  onSave,
}: {
  settings: ModelSettings;
  credentials: Credentials;
  saved: boolean;
  config: ClientConfig;
  onClose: () => void;
  onSave: (connection: SavedConnection) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [token, setToken] = useState(credentials.token);
  const [headers, setHeaders] = useState(JSON.stringify(credentials.extraHeaders, null, 2));
  const [saveSecrets, setSaveSecrets] = useState(saved);
  const [testing, setTesting] = useState(false);
  const [testedIdentity, setTestedIdentity] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testError, setTestError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const invalidate = () => {
    controller.current?.abort();
    setTesting(false);
    setTestedIdentity("");
    setTestMessage("");
  };
  const patch = (value: Partial<ModelSettings>) => {
    invalidate();
    setDraft((previous) => ({ ...previous, ...value }));
  };
  const readCredentials = (): Credentials =>
    credentialsSchema.parse({ token, extraHeaders: headersSchema.parse(JSON.parse(headers)) });
  const isPublic = draft.transport === "public" && draft.provider === "jev";
  const validate = (requireToken = false) => {
    const next = settingsSchema.parse(draft);
    if (isPublic && !config.publicEnabled) throw new Error("管理员还没有启用公共服务。");
    if (requireToken && next.provider === "jev" && !isPublic && !token.trim())
      throw new Error("请填写 API Token。");
    return { next, auth: readCredentials() };
  };
  const test = async () => {
    const active = new AbortController();
    controller.current?.abort();
    controller.current = active;
    try {
      const { next, auth } = validate(true);
      setTesting(true);
      setTestError(false);
      setTestMessage("");
      const models = await testConnection(next, auth, active.signal);
      if (active.signal.aborted || controller.current !== active) return;
      setTestedIdentity(connectionIdentity(next, auth));
      setTestMessage(
        next.provider === "mock" ? models[0] : `连接正常，找到 ${models.length} 个模型。`,
      );
    } catch (error) {
      if (active.signal.aborted || controller.current !== active) return;
      setTestError(true);
      setTestMessage(
        error instanceof z.ZodError
          ? "请检查地址、超时和额外请求头格式。"
          : error instanceof Error
            ? error.message
            : "连接测试失败。",
      );
    } finally {
      if (controller.current === active) setTesting(false);
    }
  };
  const save = () => {
    try {
      const { next, auth } = validate();
      onSave({
        settings: next,
        credentials: auth,
        saveSecrets,
        tested: testedIdentity === connectionIdentity(next, auth),
      });
    } catch (error) {
      toast.error(
        error instanceof z.ZodError
          ? "设置格式不正确，请检查各字段。"
          : error instanceof Error
            ? error.message
            : "保存失败。",
      );
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="p-6">
          <SheetTitle>模型连接</SheetTitle>
          <SheetDescription>TypeSafe v1 · Choice Provider</SheetDescription>
        </SheetHeader>
        <Separator />
        <div className="flex-1 overflow-y-auto p-6">
          <FieldGroup>
            <Selection
              id="provider"
              label="Provider"
              value={draft.provider}
              onChange={(provider) => patch({ provider: provider as ModelSettings["provider"] })}
              items={[
                { value: "jev", label: "Jev · TypeSafe v1" },
                ...(config.mockEnabled ? [{ value: "mock", label: "Mock · 仅开发测试" }] : []),
              ]}
            />
            {draft.provider === "mock" ? (
              <Alert>
                <AlertTitle>Mock 模式</AlertTitle>
                <AlertDescription>
                  按固定次序返回测试选项，不连接真实模型，不评估提示词。
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Selection
                  id="transport"
                  label="请求方式"
                  value={draft.transport}
                  onChange={(transport) =>
                    patch({
                      transport: transport as ModelSettings["transport"],
                      ...(transport === "public" ? { model: config.publicModel } : {}),
                    })
                  }
                  items={[
                    { value: "proxy", label: "后端代理 · 自带 Token" },
                    { value: "direct", label: "浏览器直连 · 自带 Token" },
                    { value: "public", label: "公共服务", disabled: !config.publicEnabled },
                  ]}
                />
                {isPublic ? (
                  <Alert>
                    <ShieldCheck />
                    <AlertTitle>公共服务</AlertTitle>
                    <AlertDescription>
                      每次最多 {config.publicMaxRounds} 轮。每 {config.rateWindowSeconds} 秒最多{" "}
                      {config.rateRequests} 次请求。
                      {config.ipMode === "shared" && "所有访客共用这个额度。"}共享 Token
                      留在服务器。
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <Field>
                      <FieldLabel htmlFor="base-url">API Base URL</FieldLabel>
                      <Input
                        id="base-url"
                        type="url"
                        value={draft.baseUrl}
                        spellCheck={false}
                        onChange={(event) => patch({ baseUrl: event.target.value })}
                      />
                      <FieldDescription>
                        填写 origin，例如 https://api.typesafe.ai。
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="api-token">API Token</FieldLabel>
                      <Input
                        id="api-token"
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(event) => {
                          invalidate();
                          setToken(event.target.value);
                        }}
                      />
                    </Field>
                  </>
                )}
                <Field data-disabled={isPublic}>
                  <FieldLabel htmlFor="model-id">模型标识符</FieldLabel>
                  <Input
                    id="model-id"
                    value={draft.model}
                    disabled={isPublic}
                    onChange={(event) => patch({ model: event.target.value })}
                  />
                </Field>
                {draft.transport === "direct" && (
                  <Alert>
                    <AlertTitle>浏览器可以读取 Token</AlertTitle>
                    <AlertDescription>
                      页面脚本和浏览器扩展可能接触凭据。目标服务必须允许 CORS，这个模式不会隐藏
                      Token。
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
            <NumberField
              id="connection-timeout"
              label="连接测试超时（毫秒）"
              value={draft.timeoutMs}
              min={1_000}
              max={120_000}
              onChange={(timeoutMs) => patch({ timeoutMs })}
            />
            {!isPublic && (
              <Accordion type="single" collapsible>
                <AccordionItem value="protocol">
                  <AccordionTrigger>协议路径和额外请求头</AccordionTrigger>
                  <AccordionContent>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="request-path">Choice 路径</FieldLabel>
                        <Input
                          id="request-path"
                          value={draft.requestPath}
                          onChange={(event) => patch({ requestPath: event.target.value })}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="models-path">模型列表路径</FieldLabel>
                        <Input
                          id="models-path"
                          value={draft.modelsPath}
                          onChange={(event) => patch({ modelsPath: event.target.value })}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="extra-headers">额外请求头（JSON）</FieldLabel>
                        <Textarea
                          id="extra-headers"
                          value={headers}
                          spellCheck={false}
                          onChange={(event) => {
                            invalidate();
                            setHeaders(event.target.value);
                          }}
                        />
                        <FieldDescription>
                          允许 X-* 和
                          TypeSafe-Danger-Zone-*。认证头由适配器构造。额外请求头按敏感信息处理。
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
            <Field orientation="horizontal">
              <FieldLabel htmlFor="save-secrets">在此浏览器保存 Token 和额外请求头</FieldLabel>
              <Switch id="save-secrets" checked={saveSecrets} onCheckedChange={setSaveSecrets} />
            </Field>
            {saveSecrets && (
              <Alert variant="destructive">
                <AlertDescription>
                  凭据会明文写入 localStorage。能访问这个浏览器环境的代码可能读取它们。
                </AlertDescription>
              </Alert>
            )}
            {testMessage && (
              <Alert variant={testError ? "destructive" : "default"}>
                {!testError && <CheckCircle2 />}
                <AlertDescription>{testMessage}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={test} disabled={testing}>
                {testing && <LoaderCircle data-icon="inline-start" className="animate-spin" />}
                测试连接
              </Button>
              <Badge variant="outline">{testedIdentity ? "测试有效" : "尚未测试"}</Badge>
            </div>
          </FieldGroup>
        </div>
        <Separator />
        <SheetFooter className="flex-row justify-between p-6">
          <Button
            variant="ghost"
            onClick={() => {
              invalidate();
              setDraft({ ...DEFAULT_SETTINGS });
              setToken("");
              setHeaders("{}");
              setSaveSecrets(false);
            }}
          >
            <RotateCcw data-icon="inline-start" />
            恢复默认
          </Button>
          <Button onClick={save}>保存设置</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
