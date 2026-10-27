"use client";

import { memo, useState } from "react";
import { z } from "zod";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  LoaderCircle,
  X,
} from "lucide-react";
import { cn } from "cn";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GenerationTask, Round } from "@/lib/domain";
import { responseSchema } from "@/lib/jev-protocol";

const requestViewSchema = z.object({
  state: z.object({ generated_text: z.string() }),
  questions: z.object({
    next_content: z.object({
      criteria: z.record(
        z.string(),
        z.object({
          action: z.string(),
          value: z.string().optional(),
          marker: z.string().optional(),
        }),
      ),
    }),
  }),
});
const STATUS = {
  waiting: "等待响应",
  retrying: "重试中",
  success: "请求成功",
  error: "请求失败",
  cancelled: "已取消",
  discarded: "已丢弃",
};

export function QuestionsPanel({ task }: { task: GenerationTask }) {
  const [openId, setOpenId] = useState<string | undefined>();
  const [pageFromEnd, setPageFromEnd] = useState(0);
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(task.history.length / pageSize));
  const page = Math.min(pageFromEnd, pages - 1);
  const end = task.history.length - page * pageSize;
  const rounds = task.history.slice(Math.max(0, end - pageSize), end);
  const latest = rounds.at(-1)?.id;
  return (
    <section
      aria-label="Questions 调试区"
      className="flex h-full min-h-[32rem] min-w-0 flex-col bg-card"
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-5">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-sm font-semibold">Questions</h2>
          <Badge variant="secondary">{task.history.length}</Badge>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="展开最新轮次"
          onClick={() => {
            setPageFromEnd(0);
            setOpenId(undefined);
          }}
        >
          <ArrowDownToLine />
        </Button>
      </div>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rounds.length ? (
          <Accordion
            type="single"
            collapsible
            value={openId ?? latest ?? ""}
            onValueChange={setOpenId}
            className="px-4"
          >
            {rounds.map((round) => (
              <RoundItem key={round.id} round={round} />
            ))}
          </Accordion>
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleHelp />
              </EmptyMedia>
              <EmptyTitle>等待第一次选择</EmptyTitle>
              <EmptyDescription>
                开始生成后，在这里检查每轮的问题、候选项和返回结果。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      <Separator />
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {task.history.length
            ? `第 ${Math.max(1, end - pageSize + 1)}–${end} 轮记录`
            : "逐轮记录 · 保存在此设备"}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              aria-label="较早的轮次"
              size="icon-xs"
              variant="ghost"
              disabled={page >= pages - 1}
              onClick={() => {
                setPageFromEnd(page + 1);
                setOpenId(undefined);
              }}
            >
              <ChevronLeft />
            </Button>
            <Button
              aria-label="较新的轮次"
              size="icon-xs"
              variant="ghost"
              disabled={!page}
              onClick={() => {
                setPageFromEnd(page - 1);
                setOpenId(undefined);
              }}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

const RoundItem = memo(function RoundItem({ round }: { round: Round }) {
  const pending = ["waiting", "retrying"].includes(round.status);
  const request = requestViewSchema.safeParse(round.request);
  const response = responseSchema.safeParse(round.response);
  const criteria = request.success ? request.data.questions.next_content.criteria : {};
  const probabilities = response.success
    ? (response.data.answers.next_content?.probabilities ?? {})
    : {};
  const [optionPage, setOptionPage] = useState(0);
  const options = Object.entries(criteria);
  return (
    <AccordionItem value={round.id}>
      <AccordionTrigger className="py-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
              round.status === "success" && "text-success",
              round.status === "error" && "text-destructive",
            )}
          >
            {pending ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : round.status === "success" ? (
              <Check className="size-3.5" />
            ) : (
              <X className="size-3.5" />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs">
                ROUND {String(round.number).padStart(3, "0")}
              </span>
              <span className="text-xs text-muted-foreground">
                {round.durationMs === undefined
                  ? "…"
                  : `${(round.durationMs / 1_000).toFixed(2)} s`}
              </span>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {STATUS[round.status]}
              {round.label && <code className="truncate text-foreground">{round.label}</code>}
              {round.attempts > 1 && <span>第 {round.attempts} 次尝试</span>}
            </span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{round.provider}</Badge>
            {round.confidence !== undefined && (
              <Badge variant="outline">confidence {round.confidence.toFixed(3)}</Badge>
            )}
          </div>
          {round.errors.map((error, index) => (
            <Alert key={index} variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ))}
          <Tabs defaultValue="inspect">
            <TabsList className="w-full">
              <TabsTrigger value="inspect">检查</TabsTrigger>
              <TabsTrigger value="request">请求</TabsTrigger>
              <TabsTrigger value="response">响应</TabsTrigger>
            </TabsList>
            <TabsContent value="inspect" className="flex flex-col gap-3 pt-2">
              <p className="text-xs leading-relaxed text-muted-foreground">{round.question}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                <dt className="text-muted-foreground">State 版本</dt>
                <dd className="font-mono">r{round.revision}</dd>
                <dt className="text-muted-foreground">选择 key</dt>
                <dd className="break-all font-mono">{round.optionKey ?? "—"}</dd>
                <dt className="text-muted-foreground">实际追加</dt>
                <dd className="break-all font-mono">
                  {round.appended === undefined ? "—" : JSON.stringify(round.appended)}
                </dd>
              </dl>
              {request.success && (
                <>
                  <p className="text-xs text-muted-foreground">发送的 State</p>
                  <pre className="trace-json">
                    {JSON.stringify(request.data.state.generated_text)}
                  </pre>
                </>
              )}
              <div className="flex items-center justify-between text-xs">
                <span>{options.length} 个候选项</span>
                {options.length > 24 && (
                  <div className="flex items-center gap-1">
                    <Button
                      aria-label="上一页候选项"
                      size="icon-xs"
                      variant="ghost"
                      disabled={!optionPage}
                      onClick={() => setOptionPage(optionPage - 1)}
                    >
                      <ChevronLeft />
                    </Button>
                    <span>
                      {optionPage + 1}/{Math.ceil(options.length / 24)}
                    </span>
                    <Button
                      aria-label="下一页候选项"
                      size="icon-xs"
                      variant="ghost"
                      disabled={(optionPage + 1) * 24 >= options.length}
                      onClick={() => setOptionPage(optionPage + 1)}
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table className="text-left font-mono text-[11px]">
                  <TableHeader className="bg-muted text-muted-foreground">
                    <TableRow>
                      <TableHead className="px-2 py-2">option key</TableHead>
                      <TableHead className="px-2 py-2">实际值</TableHead>
                      <TableHead className="px-2 py-2 text-right">p</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {options.slice(optionPage * 24, (optionPage + 1) * 24).map(([key, value]) => (
                      <TableRow
                        key={key}
                        className={cn("border-t", key === round.optionKey && "bg-primary/10")}
                      >
                        <TableCell className="max-w-28 truncate px-2 py-1.5" title={key}>
                          {key}
                        </TableCell>
                        <TableCell
                          className="max-w-40 truncate px-2 py-1.5"
                          title={JSON.stringify(value)}
                        >
                          {value.action === "finish"
                            ? `EOS ${JSON.stringify(value.marker)}`
                            : JSON.stringify(value.value)}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right">
                          {probabilities[key]?.toFixed(3) ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
            <TabsContent value="request">
              <pre className="trace-json mt-2">{JSON.stringify(round.request, null, 2)}</pre>
            </TabsContent>
            <TabsContent value="response">
              {round.response ? (
                <pre className="trace-json mt-2">{JSON.stringify(round.response, null, 2)}</pre>
              ) : (
                <p className="py-4 text-xs text-muted-foreground">
                  {pending ? "模型还没有返回结果。" : "没有收到可验证的响应。"}
                </p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
});
