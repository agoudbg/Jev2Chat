"use client";

import { useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { candidateSchema, type Candidate, type Vocabulary } from "@/lib/domain";
import {
  asciiVocabulary,
  batchCandidates,
  importVocabulary,
  validateVocabulary,
} from "@/lib/vocabulary";
import { downloadFile } from "@/lib/task-storage";
import { serializeChoice } from "@/lib/jev-protocol";
import { Selection, type Confirmation } from "./controls";

export function VocabularyEditor({
  vocabularies,
  initial,
  onClose,
  onSave,
  onDelete,
  confirm,
}: {
  vocabularies: Vocabulary[];
  initial: Vocabulary;
  onClose: () => void;
  onSave: (vocabulary: Vocabulary) => boolean;
  onDelete: (id: string) => void;
  confirm: (value: Confirmation) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const [batch, setBatch] = useState("");
  const [interpretEscapes, setInterpretEscapes] = useState(false);
  const [editing, setEditing] = useState<{ index: number; candidate: Candidate } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const errors = validateVocabulary(draft);
  const enabled = draft.candidates.filter((candidate) => candidate.enabled);
  const dirty =
    JSON.stringify(draft) !== baseline || !vocabularies.some((entry) => entry.id === draft.id);
  const replace = (next: Vocabulary) => {
    setDraft(structuredClone(next));
    setBaseline(JSON.stringify(next));
    setPage(0);
    setQuery("");
    setCategory("all");
  };
  const discardThen = (action: () => void) =>
    dirty
      ? confirm({
          title: "放弃词表编辑？",
          description: "还没有保存的词表修改会丢失。",
          label: "放弃修改",
          action,
        })
      : action();
  const visible = draft.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        (category === "all" || candidate.category === category) &&
        `${candidate.label} ${candidate.key} ${JSON.stringify(candidate.value)}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  const pages = Math.max(1, Math.ceil(visible.length / 20));
  const activePage = Math.min(page, pages - 1);
  const updateCandidate = (index: number, patch: Partial<Candidate>) =>
    setDraft((previous) => ({
      ...previous,
      candidates: previous.candidates.map((entry, itemIndex) =>
        itemIndex === index ? { ...entry, ...patch } : entry,
      ),
    }));
  const selectMany = (action: "all" | "inverse" | "none") => {
    const indices = new Set(visible.map(({ index }) => index));
    setDraft({
      ...draft,
      candidates: draft.candidates.map((candidate, index) =>
        indices.has(index)
          ? { ...candidate, enabled: action === "inverse" ? !candidate.enabled : action === "all" }
          : candidate,
      ),
    });
  };
  const save = () => {
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    const stored = vocabularies.find((entry) => entry.id === draft.id);
    const next = {
      ...draft,
      version: stored ? Math.max(stored.version, draft.version) + 1 : draft.version,
    };
    if (!onSave(next)) return;
    replace(next);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) discardThen(onClose);
      }}
    >
      <DialogContent className="flex max-h-[92dvh] flex-col gap-4 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>词表管理</DialogTitle>
          <DialogDescription>显示标签、实际值和 option key 分别编辑。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          <FieldGroup className="gap-4">
            <FieldGroup className="flex-row flex-wrap items-end gap-3">
              <div className="min-w-52 flex-1">
                <Selection
                  id="library-vocabulary"
                  label="本地词表"
                  value={draft.id}
                  items={[
                    ...vocabularies.map((entry) => ({
                      value: entry.id,
                      label: `${entry.name} · v${entry.version}`,
                    })),
                    ...(!vocabularies.some((entry) => entry.id === draft.id)
                      ? [{ value: draft.id, label: draft.name }]
                      : []),
                  ]}
                  onChange={(id) =>
                    discardThen(() => {
                      const found = vocabularies.find((entry) => entry.id === id);
                      if (found) replace(found);
                    })
                  }
                />
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  discardThen(() =>
                    replace({
                      id: crypto.randomUUID(),
                      name: "自定义词表",
                      version: 1,
                      mode: "string",
                      candidates: [asciiVocabulary().candidates.at(-1)!],
                    }),
                  )
                }
              >
                <Plus data-icon="inline-start" />
                新建
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  replace({
                    ...draft,
                    id: crypto.randomUUID(),
                    name: `${draft.name} 副本`,
                    version: 1,
                  })
                }
              >
                <Copy data-icon="inline-start" />
                复制
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="删除词表"
                disabled={
                  vocabularies.length <= 1 || !vocabularies.some((entry) => entry.id === draft.id)
                }
                onClick={() =>
                  confirm({
                    title: "删除这个词表？",
                    description: "只删除词表库里的版本。任务中已经保存的词表快照仍可继续使用。",
                    label: "删除词表",
                    destructive: true,
                    action: () => {
                      onDelete(draft.id);
                      const next = vocabularies.find((entry) => entry.id !== draft.id);
                      if (next) replace(next);
                    },
                  })
                }
              >
                <Trash2 />
              </Button>
            </FieldGroup>
            <FieldGroup className="flex-row flex-wrap gap-3">
              <Field className="min-w-44 flex-1">
                <FieldLabel htmlFor="vocabulary-name">词表名称</FieldLabel>
                <Input
                  id="vocabulary-name"
                  maxLength={100}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <div className="min-w-44">
                <Selection
                  id="vocabulary-mode"
                  label="生成粒度"
                  value={draft.mode}
                  items={[
                    { value: "character", label: "字符 · 每项一个码点" },
                    { value: "string", label: "字符串 · 每项完整追加" },
                    { value: "token", label: "词元 · 自定义字符串单元" },
                  ]}
                  onChange={(mode) => setDraft({ ...draft, mode: mode as Vocabulary["mode"] })}
                />
              </div>
            </FieldGroup>
            <Tabs defaultValue="items">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="items">候选项</TabsTrigger>
                  <TabsTrigger value="batch">批量添加</TabsTrigger>
                  <TabsTrigger value="preview">Choice 预览</TabsTrigger>
                </TabsList>
                <Badge variant={enabled.length > 255 ? "destructive" : "secondary"}>
                  {enabled.length} / 255 项启用
                </Badge>
              </div>
              <TabsContent value="items" className="flex flex-col gap-4 pt-3">
                <FieldGroup className="flex-row flex-wrap items-end gap-3">
                  <Field className="min-w-44 flex-1">
                    <FieldLabel htmlFor="vocabulary-search">搜索候选项</FieldLabel>
                    <Input
                      id="vocabulary-search"
                      type="search"
                      placeholder="标签、key 或转义值"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setPage(0);
                      }}
                    />
                  </Field>
                  <div className="min-w-40">
                    <Selection
                      id="category"
                      label="类别"
                      value={category}
                      onChange={(value) => {
                        setCategory(value);
                        setPage(0);
                      }}
                      items={[
                        { value: "all", label: "全部类别" },
                        ...Array.from(new Set(draft.candidates.map((entry) => entry.category))).map(
                          (value) => ({ value, label: value }),
                        ),
                      ]}
                    />
                  </div>
                  <Button
                    onClick={() =>
                      setEditing({
                        index: -1,
                        candidate: {
                          key: `item_${crypto.randomUUID().replaceAll("-", "")}`,
                          label: "",
                          value: "",
                          kind: "text",
                          enabled: true,
                          category: "自定义",
                        },
                      })
                    }
                  >
                    <Plus data-icon="inline-start" />
                    添加候选项
                  </Button>
                </FieldGroup>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-auto text-xs text-muted-foreground">
                    搜索结果 {visible.length} 项
                  </span>
                  <Button size="xs" variant="ghost" onClick={() => selectMany("all")}>
                    全选
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => selectMany("inverse")}>
                    反选
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => selectMany("none")}>
                    清空选择
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <Table className="text-left text-sm">
                    <TableHeader className="bg-muted text-xs text-muted-foreground">
                      <TableRow>
                        <TableHead className="w-12 p-3">
                          <span className="sr-only">启用</span>
                        </TableHead>
                        <TableHead className="p-3">显示标签</TableHead>
                        <TableHead className="p-3">实际值（JSON）</TableHead>
                        <TableHead className="p-3">option key</TableHead>
                        <TableHead className="p-3">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible
                        .slice(activePage * 20, (activePage + 1) * 20)
                        .map(({ candidate, index }) => (
                          <TableRow key={index}>
                            <TableCell className="p-3">
                              <Checkbox
                                checked={candidate.enabled}
                                aria-label={`启用 ${candidate.label || candidate.key}`}
                                onCheckedChange={(enabled) =>
                                  updateCandidate(index, { enabled: enabled === true })
                                }
                              />
                            </TableCell>
                            <TableCell className="max-w-40 truncate p-3" title={candidate.label}>
                              {candidate.label}
                              {candidate.kind === "end" && (
                                <Badge variant="outline" className="ml-2">
                                  结束
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell
                              className="max-w-52 truncate p-3 font-mono text-xs"
                              title={JSON.stringify(candidate.value)}
                            >
                              {JSON.stringify(candidate.value)}
                            </TableCell>
                            <TableCell
                              className="max-w-44 truncate p-3 font-mono text-xs"
                              title={candidate.key}
                            >
                              {candidate.key}
                            </TableCell>
                            <TableCell className="p-2">
                              <div className="flex items-center gap-1">
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  aria-label={`编辑 ${candidate.key}`}
                                  onClick={() => setEditing({ index, candidate })}
                                >
                                  编辑
                                </Button>
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={`删除 ${candidate.key}`}
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      candidates: draft.candidates.filter(
                                        (_, itemIndex) => itemIndex !== index,
                                      ),
                                    })
                                  }
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                  {!visible.length && (
                    <p className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                      <Search className="size-4" />
                      没有匹配的候选项
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      discardThen(() => {
                        const ascii = asciiVocabulary();
                        replace({
                          ...ascii,
                          id: draft.id,
                          name: draft.name,
                          version: draft.version,
                        });
                      })
                    }
                  >
                    恢复 ASCII 默认项
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="词表上一页"
                      disabled={!activePage}
                      onClick={() => setPage(activePage - 1)}
                    >
                      <ChevronLeft />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {activePage + 1} / {pages}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="词表下一页"
                      disabled={activePage === pages - 1}
                      onClick={() => setPage(activePage + 1)}
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="batch" className="pt-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="batch-options">每行一个候选项</FieldLabel>
                    <Textarea
                      id="batch-options"
                      rows={9}
                      value={batch}
                      onChange={(event) => setBatch(event.target.value)}
                    />
                    <FieldDescription>
                      空行会跳过。空格是一项；换行和制表符可启用转义后填写。
                    </FieldDescription>
                  </Field>
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="interpret-escapes">
                      解释 JSON 转义（例如 \n、\t、\\）
                    </FieldLabel>
                    <Switch
                      id="interpret-escapes"
                      checked={interpretEscapes}
                      onCheckedChange={setInterpretEscapes}
                    />
                  </Field>
                  <Button
                    className="w-fit"
                    onClick={() => {
                      try {
                        const candidates = batchCandidates(batch, interpretEscapes);
                        if (!candidates.length) throw new Error("请填写候选项。");
                        setDraft({ ...draft, candidates: [...draft.candidates, ...candidates] });
                        setBatch("");
                        toast.success(`添加了 ${candidates.length} 项，请检查并保存。`);
                      } catch {
                        toast.error("批量内容无效，请检查 JSON 转义和候选值长度。");
                      }
                    }}
                  >
                    <Plus data-icon="inline-start" />
                    添加到词表
                  </Button>
                </FieldGroup>
              </TabsContent>
              <TabsContent value="preview" className="pt-4">
                {errors.length ? (
                  <Alert variant="destructive">
                    <AlertDescription>{errors[0]}</AlertDescription>
                  </Alert>
                ) : (
                  <pre className="trace-json">
                    {JSON.stringify(
                      serializeChoice(
                        {
                          prompt: "Preview",
                          state: "",
                          round: 1,
                          requestId: "preview",
                          mode: draft.mode,
                          candidates: enabled,
                        },
                        "jev-latest",
                      ).wire,
                      null,
                      2,
                    )}
                  </pre>
                )}
              </TabsContent>
            </Tabs>
            {errors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>{errors.slice(0, 3).join("\n")}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </div>
        <Separator />
        <DialogFooter className="flex-row flex-wrap justify-between sm:justify-between">
          <div className="flex gap-2">
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="导入词表文件"
              onChange={async (event) => {
                const selected = event.target.files?.[0];
                event.target.value = "";
                if (!selected) return;
                try {
                  if (selected.size > 10 * 1024 * 1024) throw new Error("文件超过 10 MiB。");
                  const imported = importVocabulary(await selected.text());
                  discardThen(() => replace({ ...imported, id: crypto.randomUUID(), version: 1 }));
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "词表导入失败。");
                }
              }}
            />
            <Button variant="outline" onClick={() => file.current?.click()}>
              <Upload data-icon="inline-start" />
              导入 JSON
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadFile("vocabulary.json", JSON.stringify(draft, null, 2))}
            >
              <Download data-icon="inline-start" />
              导出 JSON
            </Button>
          </div>
          <Button onClick={save} disabled={Boolean(errors.length)}>
            {dirty ? "保存词表" : "保存为新版本"}
          </Button>
        </DialogFooter>
        {editing && (
          <CandidateDialog
            key={editing.index}
            candidate={editing.candidate}
            onClose={() => setEditing(null)}
            onSave={(candidate) => {
              if (editing.index < 0)
                setDraft({ ...draft, candidates: [...draft.candidates, candidate] });
              else updateCandidate(editing.index, candidate);
              setEditing(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CandidateDialog({
  candidate,
  onClose,
  onSave,
}: {
  candidate: Candidate;
  onClose: () => void;
  onSave: (candidate: Candidate) => void;
}) {
  const [draft, setDraft] = useState(candidate);
  const [value, setValue] = useState(JSON.stringify(candidate.value));
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑候选项</DialogTitle>
          <DialogDescription>实际值按 JSON 字符串填写，空白字符也能准确保存。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="candidate-label">显示标签</FieldLabel>
            <Input
              id="candidate-label"
              value={draft.label}
              maxLength={100}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="candidate-key">option key</FieldLabel>
            <Input
              id="candidate-key"
              value={draft.key}
              spellCheck={false}
              onChange={(event) => setDraft({ ...draft, key: event.target.value })}
            />
            <FieldDescription>1–64 个英文字母、数字、下划线或连字符。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="candidate-value">实际值（JSON 字符串）</FieldLabel>
            <Textarea
              id="candidate-value"
              value={value}
              spellCheck={false}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <Selection
            id="candidate-kind"
            label="选中后的行为"
            value={draft.kind}
            onChange={(kind) => setDraft({ ...draft, kind: kind as Candidate["kind"] })}
            items={[
              { value: "text", label: "追加到 State" },
              { value: "end", label: "结束生成，不追加" },
            ]}
          />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => {
              try {
                onSave(candidateSchema.parse({ ...draft, value: JSON.parse(value) }));
              } catch {
                setError("请检查显示标签、option key 和非空 JSON 字符串。");
              }
            }}
          >
            应用候选项
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
