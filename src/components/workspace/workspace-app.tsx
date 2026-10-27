"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import {
  BookOpen,
  Braces,
  ChevronDown,
  CircleHelp,
  FolderOpen,
  Menu,
  Moon,
  Plus,
  Settings2,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createTask,
  DEFAULT_SETTINGS,
  type Credentials,
  type ModelSettings,
  type Vocabulary,
} from "@/lib/domain";
import { clientConfigSchema, type ClientConfig } from "@/lib/client-config";
import { fetchJson } from "@/lib/http";
import { JevProvider } from "@/lib/jev-provider";
import { loadCredentials, loadSettings, saveCredentials, saveSettings } from "@/lib/model-settings";
import { importTask, loadWorkspace, saveWorkspace, type StoredWorkspace } from "@/lib/task-storage";
import { asciiVocabulary } from "@/lib/vocabulary";
import { WorkspaceStore } from "@/lib/workspace-store";
import { ConfigurationPanel } from "./configuration-panel";
import { ConfirmDialog, type Confirmation } from "./controls";
import { StatePanel } from "./state-panel";
import { QuestionsPanel } from "./questions-panel";
import { SettingsPanel, type SavedConnection } from "./settings-panel";
import { VocabularyEditor } from "./vocabulary-editor";

interface Boot {
  workspace: StoredWorkspace;
  config: ClientConfig;
  settings: ModelSettings;
  credentials: Credentials;
  saved: boolean;
  warning: string;
}

export function WorkspaceApplication() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <WorkspaceLoader />
      <Toaster position="bottom-right" />
    </ThemeProvider>
  );
}
function WorkspaceLoader() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [stored, raw] = await Promise.all([
          loadWorkspace(),
          fetchJson("/api/config", {}, 10_000, controller.signal),
        ]);
        const config = clientConfigSchema.parse(raw);
        let settings = { ...DEFAULT_SETTINGS };
        let auth = { credentials: { token: "", extraHeaders: {} } as Credentials, saved: false };
        let warning = "";
        try {
          settings = loadSettings();
          if (settings.provider === "jev" && settings.transport === "public")
            settings = { ...settings, model: config.publicModel };
          auth = loadCredentials();
        } catch {
          warning = "浏览器连接设置无法读取。这次先用默认连接，保存设置后可以修复。";
        }
        const vocabulary = asciiVocabulary();
        const task = createTask(vocabulary);
        const workspace =
          stored && stored.tasks.length && stored.vocabularies.length
            ? stored
            : { version: 1 as const, tasks: [task], vocabularies: [vocabulary], activeId: task.id };
        if (!controller.signal.aborted) setBoot({ workspace, config, settings, ...auth, warning });
      } catch {
        if (!controller.signal.aborted)
          setError(
            "工作区或服务配置无法读取。本地任务没有被覆盖，请检查浏览器存储和服务连接后重试。",
          );
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  if (boot) return <Workspace boot={boot} />;
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 p-6">
      <div className="flex items-center gap-3">
        <Braces className="size-6 text-primary" />
        <h1 className="text-lg font-semibold">Jev2Chat</h1>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>无法打开工作区</AlertTitle>
          <AlertDescription>
            {error}
            <Button
              variant="outline"
              className="mt-3 w-fit"
              onClick={() => {
                setError("");
                setAttempt(attempt + 1);
              }}
            >
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Skeleton className="h-12 w-full" />
          <div className="grid flex-1 gap-5 md:grid-cols-[280px_1fr]">
            <Skeleton className="min-h-80" />
            <Skeleton className="min-h-80" />
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            正在读取本地工作区…
          </p>
        </>
      )}
    </main>
  );
}
const wideQuery = "(min-width: 1024px)";
function subscribeWide(callback: () => void) {
  const media = window.matchMedia(wideQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function Workspace({ boot }: { boot: Boot }) {
  const [store] = useState(() => new WorkspaceStore(boot.workspace));
  const workspace = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const engine = store.active;
  const task = workspace.tasks.find((entry) => entry.id === workspace.activeId)!;
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(wideQuery).matches,
    () => false,
  );
  const { resolvedTheme, setTheme } = useTheme();
  const [settings, setSettings] = useState(boot.settings);
  const [credentials, setCredentials] = useState(boot.credentials);
  const [secretsSaved, setSecretsSaved] = useState(boot.saved);
  const [tested, setTested] = useState(false);
  const [panel, setPanel] = useState<"settings" | "vocabulary" | "help" | "configuration" | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [saving, setSaving] = useState("保存在此设备");
  const [storageError, setStorageError] = useState("");
  const [sourcePending, setSourcePending] = useState(false);
  const writeQueue = useRef(Promise.resolve());
  const taskFile = useRef<HTMLInputElement>(null);
  const { config } = boot;
  const busy = ["running", "pausing"].includes(task.status);
  const ready =
    settings.provider === "mock"
      ? config.mockEnabled
      : settings.transport === "public"
        ? config.publicEnabled
        : Boolean(credentials.token.trim());

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      setSaving("正在保存…");
      writeQueue.current = writeQueue.current
        .then(() => saveWorkspace(workspace))
        .then(() => {
          if (!stale) {
            setSaving("已保存在此设备");
            setStorageError("");
          }
        })
        .catch(() => {
          if (!stale) {
            setSaving("保存失败");
            setStorageError("本地存储写入失败。请导出完整任务 JSON，防止刷新后丢失这次修改。");
          }
        });
    }, 150);
    const flush = () => {
      writeQueue.current = writeQueue.current
        .then(() => saveWorkspace(store.getSnapshot()))
        .catch(() => {
          setStorageError("页面关闭前的保存失败，请导出完整任务。");
        });
    };
    window.addEventListener("pagehide", flush);
    return () => {
      stale = true;
      clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
    };
  }, [workspace, store]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (["running", "pausing"].includes(store.active.getSnapshot().status)) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      store.stopAll();
    };
  }, [store]);

  const createProvider = () => new JevProvider(settings, credentials);
  const start = async (resume = false) => {
    if (sourcePending) {
      toast.error("请先应用或放弃源码编辑。");
      return;
    }
    if (!ready) {
      setPanel("settings");
      return;
    }
    setPanel(null);
    try {
      if (resume) await engine.resume(createProvider());
      else await engine.start(createProvider());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法开始生成。");
    }
  };
  const requestStart = (resume = false) => {
    const requests =
      (resume ? Math.max(0, task.params.maxRounds - task.runRounds) : task.params.maxRounds) *
      (task.params.retries + 1);
    if (requests > 256)
      setConfirmation({
        title: "开始较长的生成任务？",
        description: `这次最多发送 ${requests} 次模型请求。每次都会提交最新的完整上下文，实际费用取决于服务商的计费。`,
        label: "开始生成",
        action: () => {
          void start(resume);
        },
      });
    else void start(resume);
  };
  const newTask = () => {
    try {
      store.add();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建任务失败。");
    }
  };
  const saveConnection = (value: SavedConnection) => {
    try {
      saveSettings(value.settings);
      saveCredentials(value.credentials, value.saveSecrets);
      if (busy) engine.stop();
      setSettings(value.settings);
      setCredentials(value.credentials);
      setSecretsSaved(value.saveSecrets);
      setTested(value.tested);
      setPanel(null);
      toast.success("连接设置已保存。");
    } catch {
      toast.error("浏览器无法保存连接设置，请检查存储权限。");
    }
  };
  const saveVocabulary = (vocabulary: Vocabulary) => {
    try {
      store.saveVocabulary(vocabulary);
      if (!busy && task.vocabulary.id === vocabulary.id)
        engine.configure({ vocabulary: structuredClone(vocabulary) });
      toast.success(busy ? "词表已保存。正在运行的任务继续用原来的版本。" : "词表已保存。");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存词表失败。");
      return false;
    }
  };
  const configPanel = (
    <ConfigurationPanel
      key={task.id}
      task={task}
      engine={engine}
      vocabularies={workspace.vocabularies}
      ready={ready && !sourcePending}
      onStart={() => requestStart()}
      onResume={() => requestStart(true)}
      onVocabulary={() => setPanel("vocabulary")}
      onStop={() => {
        engine.stop();
        toast("生成已停止，正文保留。", {
          action: { label: "重新开始", onClick: () => requestStart() },
        });
      }}
    />
  );
  return (
    <main className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Braces className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight">Jev2Chat</h1>
            <p className="text-xs text-muted-foreground">离散选择 · 递归生成</p>
          </div>
        </div>
        <nav aria-label="主导航" className="flex flex-wrap items-center gap-1 sm:gap-2">
          <Button size="sm" variant="outline" onClick={newTask} disabled={sourcePending}>
            <Plus data-icon="inline-start" />
            新建任务
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="词表"
            onClick={() => setPanel("vocabulary")}
          >
            <BookOpen data-icon="inline-start" />
            <span className="hidden sm:inline">词表</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="模型连接"
            onClick={() => setPanel("settings")}
          >
            <Settings2 data-icon="inline-start" />
            <span className="hidden sm:inline">模型连接</span>
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="帮助与协议"
            onClick={() => setPanel("help")}
          >
            <CircleHelp />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="切换明暗主题"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </nav>
      </header>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={sourcePending}>
                <FolderOpen data-icon="inline-start" />
                本地任务
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
              <DropdownMenuGroup>
                {workspace.tasks.map((entry) => (
                  <DropdownMenuItem key={entry.id} onSelect={() => store.select(entry.id)}>
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    {entry.id === task.id && <Badge variant="secondary">当前</Badge>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={newTask}>
                  <Plus />
                  新建任务
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => taskFile.current?.click()}>
                  <Upload />
                  导入任务 JSON
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    setConfirmation({
                      title: "清空这个任务？",
                      description:
                        "提示词、正文、生成参数和轮次历史都会清空。这个操作不能撤销，请先导出需要的内容。",
                      label: "清空任务",
                      destructive: true,
                      action: () => store.resetActive(),
                    })
                  }
                >
                  清空这个任务
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    setConfirmation({
                      title: "删除这个任务？",
                      description: "任务的正文、配置和轮次历史将从此设备删除。这个操作不能撤销。",
                      label: "删除任务",
                      destructive: true,
                      action: () => store.delete(task.id),
                    })
                  }
                >
                  <Trash2 />
                  删除这个任务
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="text-muted-foreground">/</span>
          <label htmlFor="task-title" className="sr-only">
            任务名称
          </label>
          <Input
            id="task-title"
            className="max-w-64"
            value={task.title}
            maxLength={100}
            disabled={busy}
            onChange={(event) => engine.configure({ title: event.target.value })}
          />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPanel("settings")}>
          <span className="size-1.5 rounded-full bg-current" />
          <span className="max-w-52 truncate font-mono text-xs">
            {settings.provider === "mock"
              ? "MOCK · 开发测试"
              : settings.transport === "public"
                ? `公共服务 · ${config.publicModel}`
                : settings.model}
          </span>
          <Badge variant={ready ? "outline" : "secondary"}>
            {!ready ? "未配置" : tested ? "连接正常" : "未测试"}
          </Badge>
        </Button>
      </div>
      {(boot.warning || storageError) && (
        <div className="px-4 pb-3 sm:px-6">
          <Alert variant="destructive">
            <AlertDescription>{storageError || boot.warning}</AlertDescription>
          </Alert>
        </div>
      )}
      {!ready && (
        <div className="px-4 pb-3 sm:px-6">
          <Alert>
            <AlertDescription className="flex flex-row flex-wrap items-center justify-between gap-3">
              <span>连接 Jev 后开始生成。Token 默认只在这个页面会话中保留。</span>
              <Button size="sm" variant="outline" onClick={() => setPanel("settings")}>
                配置连接
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}
      {settings.provider === "mock" && (
        <div className="px-4 pb-3 sm:px-6">
          <Alert>
            <AlertTitle>MOCK · 开发测试</AlertTitle>
            <AlertDescription>
              结果由固定测试规则返回，不代表 Jev 的选择。生产环境会关闭此模式。
            </AlertDescription>
          </Alert>
        </div>
      )}
      {settings.transport === "public" && settings.provider !== "mock" && (
        <div className="px-4 pb-3 sm:px-6">
          <Alert>
            <AlertDescription>
              公共服务 · 每次最多 {config.publicMaxRounds} 轮，每 {config.rateWindowSeconds} 秒最多{" "}
              {config.rateRequests} 次请求，全天全站最多 {config.dailyRequests} 次。
              {config.ipMode === "shared" && "所有访客共用频率和并发额度。"}
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className="min-h-0 flex-1 border-y lg:mx-6 lg:mb-4 lg:overflow-hidden lg:rounded-lg lg:border">
        {wide ? (
          <div className="flex h-full">
            <aside className="w-72 shrink-0 border-r">{configPanel}</aside>
            <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
              <ResizablePanel defaultSize="60%" minSize="30%">
                <StatePanel
                  task={task}
                  engine={engine}
                  sourcePending={sourcePending}
                  onSourcePendingChange={setSourcePending}
                  confirm={setConfirmation}
                  onExample={() =>
                    engine.configure({
                      prompt: "Write a short, warm letter to a friend I have not seen in years.",
                    })
                  }
                />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="40%" minSize="25%">
                <QuestionsPanel key={`${task.id}:${task.runId}`} task={task} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="px-4 pt-3">
              <Button variant="outline" size="sm" onClick={() => setPanel("configuration")}>
                <Menu data-icon="inline-start" />
                生成配置
              </Button>
            </div>
            <Tabs defaultValue="state" className="gap-0">
              <TabsList className="m-4">
                <TabsTrigger value="state">State</TabsTrigger>
                <TabsTrigger value="questions">Questions · {task.history.length}</TabsTrigger>
              </TabsList>
              <TabsContent value="state">
                <StatePanel
                  task={task}
                  engine={engine}
                  sourcePending={sourcePending}
                  onSourcePendingChange={setSourcePending}
                  confirm={setConfirmation}
                  onExample={() => {
                    engine.configure({ prompt: "Write a short, warm letter to a friend." });
                    setPanel("configuration");
                  }}
                />
              </TabsContent>
              <TabsContent value="questions">
                <QuestionsPanel key={`${task.id}:${task.runId}`} task={task} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-2 text-[11px] text-muted-foreground sm:px-6">
        <span role="status">{saving}</span>
        <span>
          TypeSafe v1 · {task.vocabulary.name} v{task.vocabulary.version}
        </span>
        <span>Token {secretsSaved ? "保存于此浏览器" : "仅此页面会话"}</span>
      </footer>
      <input
        ref={taskFile}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="导入任务文件"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            if (file.size > 10 * 1024 * 1024) throw new Error("文件超过 10 MiB。");
            store.add(importTask(await file.text()));
            toast.success("任务已导入。");
          } catch {
            toast.error("任务导入失败，请检查文件格式和 10 MiB 大小限制。");
          }
        }}
      />
      {panel === "settings" && (
        <SettingsPanel
          settings={settings}
          credentials={credentials}
          saved={secretsSaved}
          config={config}
          onClose={() => setPanel(null)}
          onSave={saveConnection}
        />
      )}
      {panel === "vocabulary" && (
        <VocabularyEditor
          vocabularies={workspace.vocabularies}
          initial={
            workspace.vocabularies.find((entry) => entry.id === task.vocabulary.id) ??
            task.vocabulary
          }
          onClose={() => setPanel(null)}
          onSave={saveVocabulary}
          onDelete={(id) => store.deleteVocabulary(id)}
          confirm={setConfirmation}
        />
      )}
      {panel === "configuration" && (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setPanel(null);
          }}
        >
          <SheetContent side="left" className="w-full gap-0 sm:max-w-sm">
            <SheetHeader>
              <SheetTitle>生成配置</SheetTitle>
            </SheetHeader>
            {configPanel}
          </SheetContent>
        </Sheet>
      )}
      {panel === "help" && <HelpDialog onClose={() => setPanel(null)} />}
      <ConfirmDialog value={confirmation} onClose={() => setConfirmation(null)} />
    </main>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choice 如何生成文本</DialogTitle>
          <DialogDescription>每轮都是一次新的、依赖上一轮 State 的离散选择。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5 text-sm leading-relaxed">
          <ol className="ml-5 flex list-decimal flex-col gap-2">
            <li>把提示词、State 和启用的候选项交给 Jev。</li>
            <li>读取返回的 option key，找到对应的实际值。</li>
            <li>追加实际值，再用更新后的 State 发起下一轮。</li>
            <li>选中结束项、命中停止字符串或达到限制后结束。</li>
          </ol>
          <Separator />
          <p>
            字符模式以 Unicode
            码点为单位。字符串和词元模式把每个候选值作为一个完整单元。词元来自你定义的词表，和模型内部
            tokenizer 没有绑定。
          </p>
          <p>
            EOS 是应用定义的结束候选项。标记值会发给 Jev，但选中后不会追加到正文。空响应和无效 key
            会显示为请求失败。
          </p>
          <p>
            暂停会等待已经发出的请求结束。停止会立即取消请求并忽略迟到结果。编辑 State
            会暂停任务，让后续请求用新内容。刷新后运行会恢复成暂停状态。
          </p>
          <p>
            任务、词表和逐轮请求正文保存在这个浏览器的
            IndexedDB。浏览器清理网站数据后会删除它们。导出 JSON 可以备份任务，Token
            不包含在任务文件中。
          </p>
          <p>
            代理只允许管理员配置的 API origin。直连需要服务商允许 CORS。公共服务用服务器 Token
            和共享 Redis 限流；配额限制是请求次数，不能当作精确的金额预算。
          </p>
          <Alert>
            <AlertDescription>
              递归写作的质量和速度取决于模型、候选项和提示词。每轮都重新提交逐渐增长的上下文，长任务可能消耗很多请求。
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-4">
            <a
              href="https://docs.typesafe.ai/primitives/choice"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-4"
            >
              Choice 官方协议
            </a>
            <a
              href="https://docs.typesafe.ai/api/system-one"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-4"
            >
              HTTP API
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
