"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { characterCount, type GenerationTask } from "@/lib/domain";
import { exportTask } from "@/lib/task-storage";
import type { ChoiceGenerator } from "@/lib/generator";
import { type Confirmation, StatusBadge } from "./controls";

export function StatePanel({
  task,
  engine,
  confirm,
  onExample,
  sourcePending,
  onSourcePendingChange,
}: {
  task: GenerationTask;
  engine: ChoiceGenerator;
  confirm: (value: Confirmation) => void;
  onExample: () => void;
  sourcePending: boolean;
  onSourcePendingChange: (pending: boolean) => void;
}) {
  const [view, setView] = useState("text");
  const [autoScroll, setAutoScroll] = useState(true);
  const editor = useRef<HTMLTextAreaElement>(null);
  const hasCR = task.state.includes("\r");
  useEffect(() => {
    if (autoScroll && editor.current && document.activeElement !== editor.current)
      editor.current.scrollTop = editor.current.scrollHeight;
  }, [task.state, autoScroll]);
  const clear = () =>
    confirm({
      title: "清空 State？",
      description: "正文会清空。轮次历史还会保留，后续生成将以空文本为上下文。",
      label: "清空 State",
      destructive: true,
      action: () => engine.editState(""),
    });
  return (
    <section
      aria-label="State 工作区"
      className="flex h-full min-h-[32rem] min-w-0 flex-col bg-card"
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-5">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-sm font-semibold">State</h2>
          <StatusBadge status={task.status} />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="复制 State"
            disabled={!task.state}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(task.state);
                toast.success("已复制 State。");
              } catch {
                toast.error("剪贴板访问失败，请手动复制。 ");
              }
            }}
          >
            <Copy />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="导出任务">
                <Download />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => exportTask(task, "txt")}>
                  导出 TXT
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportTask(task, "md")}>
                  导出 Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportTask(task, "json")}>
                  导出完整任务 JSON
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportTask(task, "trace")}>
                  导出 Choice 记录
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="清空 State"
            onClick={clear}
            disabled={!task.state}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <Separator />
      <Tabs
        value={view}
        onValueChange={(next) => {
          if (sourcePending && next !== "source")
            confirm({
              title: "放弃源码编辑？",
              description: "这段源码还没有应用到 State。",
              label: "放弃编辑",
              action: () => setView(next),
            });
          else setView(next);
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex items-center justify-between gap-2 px-5 py-3">
          <TabsList>
            <TabsTrigger value="text">正文</TabsTrigger>
            <TabsTrigger value="source">源码</TabsTrigger>
          </TabsList>
          <Field orientation="horizontal" className="w-auto shrink-0 gap-2">
            <FieldLabel htmlFor="auto-scroll" className="whitespace-nowrap text-xs">
              自动滚动
            </FieldLabel>
            <Switch
              id="auto-scroll"
              size="sm"
              checked={autoScroll}
              onCheckedChange={setAutoScroll}
            />
          </Field>
        </div>
        <TabsContent value="text" className="flex min-h-0 flex-col">
          {hasCR && (
            <Alert className="mx-5 mb-3 w-auto">
              <AlertDescription>
                正文含有回车符（<code>{"\\r"}</code>）。请用源码编辑，以免浏览器把它转换成换行符。
              </AlertDescription>
            </Alert>
          )}
          <label htmlFor="state-editor" className="sr-only">
            State 正文
          </label>
          <Textarea
            ref={editor}
            id="state-editor"
            variant="editor"
            readOnly={hasCR}
            value={task.state}
            maxLength={200_000}
            onChange={(event) => engine.editState(event.target.value)}
            placeholder="在这里写入开头，或者让模型从空白开始…"
            className="min-h-48 flex-1"
            spellCheck={false}
          />
          {!task.state && task.status === "idle" && (
            <Empty className="flex-none pb-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText />
                </EmptyMedia>
                <EmptyTitle>让文字逐步生长</EmptyTitle>
                <EmptyDescription>填写提示词，选择候选项，然后连接模型。</EmptyDescription>
              </EmptyHeader>
              <Button variant="outline" size="sm" onClick={onExample}>
                填入示例提示词
              </Button>
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="source" className="flex min-h-0 flex-col">
          <SourceEditor
            key={`${task.id}:${task.runId}:${task.revision}`}
            text={task.state}
            onPendingChange={onSourcePendingChange}
            onEdit={(text) => engine.editState(text)}
            onTyping={() => {
              if (task.status === "running") engine.pause();
            }}
          />
        </TabsContent>
      </Tabs>
      {task.reason && (
        <div className="px-5 pb-3">
          <Alert variant={task.status === "error" ? "destructive" : "default"}>
            <AlertDescription>{task.reason}</AlertDescription>
          </Alert>
        </div>
      )}
      <Separator />
      <div
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-5 py-3 font-mono text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span>
          {characterCount(task.state).toLocaleString()} 字符 · {task.state.split("\n").length} 行
        </span>
        <span>
          第 {task.runRounds} 轮 / {task.params.maxRounds} · 共 {task.requests} 次请求
        </span>
      </div>
    </section>
  );
}
function SourceEditor({
  text,
  onEdit,
  onTyping,
  onPendingChange,
}: {
  text: string;
  onEdit: (text: string) => void;
  onTyping: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => onPendingChange(false), [onPendingChange]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <label htmlFor="source-editor" className="sr-only">
        State JSON 字符串
      </label>
      <Textarea
        id="source-editor"
        variant="editor"
        className="min-h-64 flex-1"
        spellCheck={false}
        value={draft ?? JSON.stringify(text)}
        onChange={(event) => {
          onTyping();
          onPendingChange(true);
          setDraft(event.target.value);
          setError("");
        }}
      />
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        <Button
          size="sm"
          disabled={draft === null}
          onClick={() => {
            try {
              const next = z
                .string()
                .max(200_000)
                .parse(JSON.parse(draft ?? ""));
              onEdit(next);
              setDraft(null);
              onPendingChange(false);
              setError("");
            } catch {
              setError("请输入有效的 JSON 字符串，包括开头和结尾的双引号。");
            }
          }}
        >
          应用到 State
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={draft === null}
          onClick={() => {
            setDraft(null);
            onPendingChange(false);
            setError("");
          }}
        >
          放弃编辑
        </Button>
        <span className="text-xs text-muted-foreground">
          JSON 字符串 · 保留 {"\\n、\\r 和 \\t"}
        </span>
        {draft !== null && (
          <p role="status" className="w-full text-xs text-warning">
            源码尚未应用。应用或放弃编辑后才能开始或继续生成。
          </p>
        )}
        {error && (
          <p role="alert" className="w-full text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
