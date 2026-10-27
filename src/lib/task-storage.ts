import { createStore, get, set } from "idb-keyval";
import { z } from "zod";
import { MAX_IMPORT_BYTES, taskSchema, vocabularySchema, type GenerationTask } from "./domain";

export const workspaceSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema).min(1).max(30),
  vocabularies: z.array(vocabularySchema).min(1).max(50),
  activeId: z.string(),
});
export type StoredWorkspace = z.infer<typeof workspaceSchema>;
const KEY = "workspace.v1";
let workspaceStore: ReturnType<typeof createStore> | undefined;
function store() {
  return (workspaceStore ??= createStore("jev2chat", "workspace"));
}

export function restoreTask(task: GenerationTask): GenerationTask {
  const interrupted = ["running", "pausing"].includes(task.status);
  return {
    ...task,
    status: interrupted ? "paused" : task.status,
    reason: interrupted ? "页面上次关闭时正在生成。检查 State 后可以继续。" : task.reason,
    history: task.history.map((round) =>
      ["waiting", "retrying"].includes(round.status)
        ? {
            ...round,
            status: "discarded",
            errors: [...round.errors, "页面关闭，响应没有提交到 State。"],
          }
        : round,
    ),
  };
}
export async function loadWorkspace(): Promise<StoredWorkspace | undefined> {
  const data: unknown = await get(KEY, store());
  if (!data) return undefined;
  const parsed = workspaceSchema.parse(data);
  return { ...parsed, tasks: parsed.tasks.map(restoreTask) };
}
export async function saveWorkspace(workspace: StoredWorkspace): Promise<void> {
  await set(KEY, workspaceSchema.parse(workspace), store());
}
export function importTask(text: string): GenerationTask {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
    throw new Error("任务文件超过 10 MiB。");
  const task = taskSchema.parse(JSON.parse(text));
  return restoreTask({ ...task, id: crypto.randomUUID() });
}
export function downloadFile(filename: string, content: string, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
export function exportTask(task: GenerationTask, format: "txt" | "md" | "json" | "trace") {
  const name = task.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 60) || "experiment";
  const content =
    format === "json"
      ? JSON.stringify(task, null, 2)
      : format === "trace"
        ? JSON.stringify(task.history, null, 2)
        : task.state;
  downloadFile(
    `${name}${format === "trace" ? ".trace.json" : `.${format}`}`,
    content,
    format === "txt" ? "text/plain" : format === "md" ? "text/markdown" : "application/json",
  );
}
