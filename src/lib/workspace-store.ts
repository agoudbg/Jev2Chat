import { ChoiceGenerator } from "./generator";
import { createTask, type GenerationTask, type Vocabulary } from "./domain";
import type { StoredWorkspace } from "./task-storage";

export class WorkspaceStore {
  private snapshot: StoredWorkspace;
  private engines = new Map<string, ChoiceGenerator>();
  private listeners = new Set<() => void>();
  constructor(workspace: StoredWorkspace) {
    this.snapshot = workspace;
    for (const task of workspace.tasks) this.addEngine(task);
    if (!this.engines.has(workspace.activeId))
      this.snapshot = { ...workspace, activeId: workspace.tasks[0].id };
  }
  private addEngine(task: GenerationTask) {
    const engine = new ChoiceGenerator(task);
    this.engines.set(task.id, engine);
    engine.subscribe(() =>
      this.update({
        tasks: this.snapshot.tasks.map((entry) =>
          entry.id === task.id ? engine.getSnapshot() : entry,
        ),
      }),
    );
    return engine;
  }
  private update(patch: Partial<StoredWorkspace>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  get active() {
    return this.engines.get(this.snapshot.activeId)!;
  }
  select(id: string) {
    if (!this.engines.has(id)) throw new Error("找不到这个任务。");
    if (id === this.snapshot.activeId) return;
    if (["running", "pausing"].includes(this.active.getSnapshot().status)) this.active.stop();
    this.update({ activeId: id });
  }
  add(task = createTask(this.snapshot.vocabularies[0])) {
    if (this.snapshot.tasks.length >= 30)
      throw new Error("最多保存 30 个任务，请先导出并删除旧任务。");
    if (["running", "pausing"].includes(this.active.getSnapshot().status)) this.active.stop();
    this.addEngine(task);
    this.update({ tasks: [...this.snapshot.tasks, task], activeId: task.id });
  }
  delete(id: string) {
    this.engines.get(id)?.stop();
    this.engines.delete(id);
    const tasks = this.snapshot.tasks.filter((entry) => entry.id !== id);
    if (!tasks.length) {
      const task = createTask(this.snapshot.vocabularies[0]);
      tasks.push(task);
      this.addEngine(task);
    }
    this.update({
      tasks,
      activeId: id === this.snapshot.activeId ? tasks[0].id : this.snapshot.activeId,
    });
  }
  resetActive() {
    const previous = this.active.getSnapshot();
    this.active.stop();
    const task = {
      ...createTask(previous.vocabulary),
      id: previous.id,
      title: previous.title,
      createdAt: previous.createdAt,
    };
    this.addEngine(task);
    this.update({
      tasks: this.snapshot.tasks.map((entry) => (entry.id === task.id ? task : entry)),
    });
  }
  saveVocabulary(vocabulary: Vocabulary) {
    const exists = this.snapshot.vocabularies.some((entry) => entry.id === vocabulary.id);
    if (!exists && this.snapshot.vocabularies.length >= 50) throw new Error("最多保存 50 个词表。");
    this.update({
      vocabularies: exists
        ? this.snapshot.vocabularies.map((entry) =>
            entry.id === vocabulary.id ? vocabulary : entry,
          )
        : [...this.snapshot.vocabularies, vocabulary],
    });
  }
  deleteVocabulary(id: string) {
    if (this.snapshot.vocabularies.length <= 1) throw new Error("至少保留一个词表。");
    this.update({ vocabularies: this.snapshot.vocabularies.filter((entry) => entry.id !== id) });
  }
  stopAll() {
    for (const engine of this.engines.values())
      if (["running", "pausing"].includes(engine.getSnapshot().status)) engine.stop();
  }
}
