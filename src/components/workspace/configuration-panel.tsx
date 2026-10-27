"use client";

import { memo, useState } from "react";
import { Braces, ChevronRight, LoaderCircle, Pause, Play, Square, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  paramsSchema,
  type GenerationParams,
  type GenerationTask,
  type Vocabulary,
} from "@/lib/domain";
import { validateVocabulary } from "@/lib/vocabulary";
import type { ChoiceGenerator } from "@/lib/generator";
import { NumberField, Selection } from "./controls";

export const ConfigurationPanel = memo(function ConfigurationPanel({
  task,
  engine,
  vocabularies,
  onStart,
  onResume,
  onStop,
  onVocabulary,
  ready,
}: {
  task: GenerationTask;
  engine: ChoiceGenerator;
  vocabularies: Vocabulary[];
  ready: boolean;
  onStart: () => void;
  onResume: () => void;
  onStop: () => void;
  onVocabulary: () => void;
}) {
  const busy = ["running", "pausing"].includes(task.status);
  const [stopText, setStopText] = useState(
    task.params.stopStrings.map((value) => JSON.stringify(value)).join("\n"),
  );
  const [stopError, setStopError] = useState("");
  const setParam = (patch: Partial<GenerationParams>) =>
    engine.configure({ params: { ...task.params, ...patch } });
  const errors = validateVocabulary(task.vocabulary);
  const valid = paramsSchema.safeParse(task.params).success && !errors.length && !stopError;
  const choices = task.vocabulary.candidates.filter((candidate) => candidate.enabled);
  const items = vocabularies.map((vocabulary) => ({
    value: vocabulary.id,
    label: vocabulary.name,
  }));
  if (!items.some((item) => item.value === task.vocabulary.id))
    items.push({ value: task.vocabulary.id, label: `${task.vocabulary.name} · 任务快照` });
  return (
    <section aria-label="生成配置" className="flex h-full flex-col bg-card">
      <div className="flex h-14 shrink-0 items-center justify-between px-5">
        <h2 className="text-sm font-semibold">生成配置</h2>
        <Badge variant="outline">Choice</Badge>
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <FieldGroup>
          <Field data-disabled={busy}>
            <FieldLabel htmlFor="prompt">提示词</FieldLabel>
            <Textarea
              id="prompt"
              rows={7}
              disabled={busy}
              maxLength={20_000}
              value={task.prompt}
              placeholder="描述你希望生成的内容…"
              onChange={(event) => engine.configure({ prompt: event.target.value })}
            />
            <FieldDescription>每轮都会带上提示词和最新 State。</FieldDescription>
          </Field>
          <Selection
            id="vocabulary"
            label="候选词表"
            value={task.vocabulary.id}
            disabled={busy}
            items={items}
            onChange={(id) => {
              const vocabulary = vocabularies.find((entry) => entry.id === id);
              if (vocabulary) engine.configure({ vocabulary: structuredClone(vocabulary) });
            }}
          />
          <div className="-mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {choices.length} / 255 项 · v{task.vocabulary.version}
            </span>
            <Button size="xs" variant="ghost" onClick={onVocabulary}>
              编辑词表
              <ChevronRight data-icon="inline-end" />
            </Button>
          </div>
          <Field data-disabled={busy}>
            <FieldLabel id="granularity-label">生成粒度</FieldLabel>
            <ToggleGroup
              aria-labelledby="granularity-label"
              type="single"
              variant="outline"
              disabled={busy}
              value={task.vocabulary.mode}
              onValueChange={(mode) => {
                if (mode)
                  engine.configure({
                    vocabulary: { ...task.vocabulary, mode: mode as Vocabulary["mode"] },
                  });
              }}
              className="w-full"
            >
              <ToggleGroupItem value="character" className="flex-1">
                字符
              </ToggleGroupItem>
              <ToggleGroupItem value="string" className="flex-1">
                字符串
              </ToggleGroupItem>
              <ToggleGroupItem value="token" className="flex-1">
                词元
              </ToggleGroupItem>
            </ToggleGroup>
            {task.vocabulary.mode !== "character" && (
              <FieldDescription>
                每轮追加一个完整的自定义{task.vocabulary.mode === "token" ? "词元" : "字符串"}
                ，可以包含多个字符。
              </FieldDescription>
            )}
          </Field>
          <NumberField
            id="max-rounds"
            label="最大生成轮数"
            value={task.params.maxRounds}
            min={1}
            max={1_000}
            disabled={busy}
            onChange={(maxRounds) => setParam({ maxRounds })}
          />
          <Field>
            <FieldLabel>结束标记</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {choices
                .filter((candidate) => candidate.kind === "end")
                .map((candidate) => (
                  <Badge key={candidate.key} variant="secondary">
                    {candidate.label}
                  </Badge>
                ))}
              {!choices.some((candidate) => candidate.kind === "end") && (
                <span className="text-sm text-warning">未启用，将按轮数或停止条件结束</span>
              )}
            </div>
          </Field>
          <Accordion type="single" collapsible>
            <AccordionItem value="advanced">
              <AccordionTrigger>生成限制和重试</AccordionTrigger>
              <AccordionContent>
                <FieldGroup>
                  <NumberField
                    id="max-chars"
                    label="最大字符数（Unicode 码点）"
                    value={task.params.maxChars}
                    min={1}
                    max={100_000}
                    disabled={busy}
                    onChange={(maxChars) => setParam({ maxChars })}
                  />
                  <NumberField
                    id="request-timeout"
                    label="单次请求超时（毫秒）"
                    value={task.params.timeoutMs}
                    min={1_000}
                    max={120_000}
                    disabled={busy}
                    onChange={(timeoutMs) => setParam({ timeoutMs })}
                  />
                  <NumberField
                    id="retries"
                    label="单轮重试次数"
                    value={task.params.retries}
                    min={0}
                    max={3}
                    disabled={busy}
                    onChange={(retries) => setParam({ retries })}
                  />
                  <NumberField
                    id="interval"
                    label="请求间隔（毫秒）"
                    value={task.params.intervalMs}
                    min={0}
                    max={30_000}
                    disabled={busy}
                    onChange={(intervalMs) => setParam({ intervalMs })}
                  />
                  <Field data-invalid={Boolean(stopError)} data-disabled={busy}>
                    <FieldLabel htmlFor="stop-strings">停止字符串</FieldLabel>
                    <Textarea
                      id="stop-strings"
                      rows={3}
                      value={stopText}
                      disabled={busy}
                      aria-invalid={Boolean(stopError)}
                      placeholder={'"END"\n"\\n\\n"'}
                      onChange={(event) => {
                        const text = event.target.value;
                        setStopText(text);
                        try {
                          const stopStrings = text
                            .split("\n")
                            .filter((line) => line.trim())
                            .map((line): string => {
                              const parsed: unknown = JSON.parse(line);
                              if (typeof parsed !== "string" || !parsed.length) throw new Error();
                              return parsed;
                            });
                          setParam({ stopStrings });
                          setStopError("");
                        } catch {
                          setStopError('每行填写一个非空 JSON 字符串，例如 "END"。');
                        }
                      }}
                    />
                    <FieldDescription>
                      {stopError || "每行一个 JSON 字符串。命中后保留正文里的停止字符串。"}
                    </FieldDescription>
                  </Field>
                  <Field orientation="horizontal" data-disabled={busy}>
                    <FieldLabel htmlFor="retry-ambiguous">重试超时或网络中断</FieldLabel>
                    <Switch
                      id="retry-ambiguous"
                      disabled={busy}
                      checked={task.params.retryAmbiguous}
                      onCheckedChange={(retryAmbiguous) => setParam({ retryAmbiguous })}
                    />
                  </Field>
                  {task.params.retryAmbiguous && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        上游可能已经处理请求。这类重试可能再次计费；同一轮最多追加一次。
                      </AlertDescription>
                    </Alert>
                  )}
                </FieldGroup>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>{errors[0]}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>
      </div>
      <Separator />
      <div className="flex shrink-0 flex-col gap-3 p-5">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Braces className="size-3.5" />
          最多{" "}
          {Number.isFinite(task.params.maxRounds * (task.params.retries + 1))
            ? task.params.maxRounds * (task.params.retries + 1)
            : "—"}{" "}
          次模型请求（含重试）
        </p>
        {busy ? (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => engine.pause()}
              disabled={task.status === "pausing"}
              variant="outline"
            >
              {task.status === "pausing" ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <Pause data-icon="inline-start" />
              )}
              暂停
            </Button>
            <Button variant="destructive" onClick={onStop}>
              <Square data-icon="inline-start" />
              停止
            </Button>
          </div>
        ) : (
          <>
            {task.status === "paused" && (
              <Button onClick={onResume} disabled={!ready || !valid}>
                <Play data-icon="inline-start" />
                继续生成
              </Button>
            )}
            <Button
              onClick={onStart}
              variant={task.status === "paused" ? "outline" : "default"}
              disabled={!ready || !valid || !task.prompt.trim()}
            >
              {task.runRounds > 0 ? (
                <RotateCcw data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {task.runRounds > 0 ? "从当前 State 重新开始" : "开始生成"}
            </Button>
          </>
        )}
      </div>
    </section>
  );
});
