import { characterCount, paramsSchema, type GenerationTask, type Round } from "./domain";
import { abortableDelay, ChoiceError, type ChoiceProvider, type ChoiceResult } from "./provider";
import { validateVocabulary } from "./vocabulary";

export class ChoiceGenerator {
  private task: GenerationTask;
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private epoch = 0;
  private loop?: Promise<void>;
  private provider?: ChoiceProvider;

  constructor(task: GenerationTask) {
    this.task = task;
  }
  getSnapshot = (): GenerationTask => this.task;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<GenerationTask>) {
    this.task = { ...this.task, ...patch, updatedAt: new Date().toISOString() };
    for (const listener of this.listeners) listener();
  }
  private updateRound(id: string, patch: Partial<Round>) {
    this.update({
      history: this.task.history.map((round) => (round.id === id ? { ...round, ...patch } : round)),
    });
  }
  configure(patch: Partial<Pick<GenerationTask, "prompt" | "vocabulary" | "params" | "title">>) {
    if (["running", "pausing"].includes(this.task.status))
      throw new Error("Pause generation before changing its configuration.");
    if (this.task.status === "paused") this.stop();
    this.update(patch);
  }
  editState(state: string) {
    const active = ["running", "pausing", "paused"].includes(this.task.status);
    this.cancelPending("discarded");
    this.update({
      state,
      revision: this.task.revision + 1,
      status: active ? "paused" : "idle",
      reason: active ? "State 已修改，继续时会用新内容。" : "",
    });
  }
  pause() {
    if (this.task.status === "running")
      this.update({ status: "pausing", reason: "等本轮结束后暂停。" });
  }
  stop() {
    this.cancelPending("cancelled");
    this.update({ status: "stopped", reason: "已停止。" });
  }
  private cancelPending(status: "cancelled" | "discarded") {
    this.epoch++;
    this.controller?.abort();
    this.update({
      history: this.task.history.map((round) =>
        ["waiting", "retrying"].includes(round.status)
          ? { ...round, status, finishedAt: new Date().toISOString() }
          : round,
      ),
    });
  }
  async start(provider: ChoiceProvider) {
    this.cancelPending("cancelled");
    await this.loop;
    this.provider = provider;
    this.update({ runId: crypto.randomUUID(), runRounds: 0, status: "idle", reason: "" });
    return this.launch();
  }
  async resume(provider?: ChoiceProvider) {
    await this.loop;
    if (provider) this.provider = provider;
    if (this.task.status !== "paused" && this.task.status !== "error") return;
    return this.launch();
  }
  private async launch() {
    if (!this.provider) throw new Error("A provider is required to continue.");
    const params = paramsSchema.parse(this.task.params);
    const errors = validateVocabulary(this.task.vocabulary);
    if (errors.length) throw new Error(errors.join("\n"));
    if (!this.task.prompt.trim()) throw new Error("请填写生成提示词。");
    const epoch = ++this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    this.update({ status: "running", reason: "" });
    const provider = this.provider;
    this.loop = this.run(provider, params, controller, epoch);
    await this.loop;
  }
  private finish(reason: string) {
    this.update({ status: "completed", reason });
  }
  private isPausing() {
    return this.task.status === "pausing";
  }
  private async run(
    provider: ChoiceProvider,
    params: GenerationTask["params"],
    controller: AbortController,
    epoch: number,
  ) {
    const signal = controller.signal;
    try {
      await provider.begin(params, signal);
      while (epoch === this.epoch && !signal.aborted) {
        if (this.task.status === "pausing") {
          this.update({ status: "paused", reason: "已暂停。" });
          return;
        }
        if (this.task.runRounds >= params.maxRounds) {
          this.finish("达到最大轮数。");
          return;
        }
        if (characterCount(this.task.state) >= params.maxChars) {
          this.finish("达到最大字符数。");
          return;
        }
        if (params.stopStrings.some((stop) => this.task.state.includes(stop))) {
          this.finish("命中停止字符串。");
          return;
        }
        if (this.task.history.length >= 5_000)
          throw new ChoiceError("任务历史已达 5,000 轮，请导出后新建任务。", "history_limit");
        const number = this.task.runRounds + 1;
        const revision = this.task.revision;
        const id = `${this.task.runId}:${number}`;
        const request = provider.prepare({
          prompt: this.task.prompt,
          state: this.task.state,
          candidates: this.task.vocabulary.candidates.filter((candidate) => candidate.enabled),
          mode: this.task.vocabulary.mode,
          round: number,
          requestId: id,
        });
        const started = Date.now();
        const attemptErrors: string[] = [];
        const round: Round = {
          id,
          runId: this.task.runId,
          number,
          revision,
          provider: provider.id,
          startedAt: new Date().toISOString(),
          status: "waiting",
          attempts: 0,
          question: request.question,
          request: request.wire,
          errors: [],
        };
        this.update({ runRounds: number, history: [...this.task.history, round] });
        let result: ChoiceResult | undefined;
        for (let attempt = 0; attempt <= params.retries; attempt++) {
          if (epoch !== this.epoch || signal.aborted) return;
          this.update({ requests: this.task.requests + 1 });
          this.updateRound(id, { attempts: attempt + 1, status: attempt ? "retrying" : "waiting" });
          try {
            result = await provider.choose(request, signal);
            break;
          } catch (error) {
            if (epoch !== this.epoch || signal.aborted) return;
            const failure =
              error instanceof ChoiceError
                ? error
                : new ChoiceError("请求中断，可能已经计费。", "network", true, true);
            const message = failure.ambiguous
              ? `${failure.message} 服务可能已经处理这次请求；重试可能再次计费。`
              : failure.message;
            attemptErrors.push(message);
            this.updateRound(id, { errors: [...attemptErrors] });
            if (
              !failure.retryable ||
              (failure.ambiguous && !params.retryAmbiguous) ||
              attempt === params.retries
            ) {
              this.updateRound(id, {
                status: "error",
                durationMs: Date.now() - started,
                finishedAt: new Date().toISOString(),
              });
              throw new ChoiceError(message, failure.code);
            }
            await abortableDelay(Math.max(500 * 2 ** attempt, failure.retryAfterMs), signal);
          }
        }
        if (epoch !== this.epoch || signal.aborted || revision !== this.task.revision || !result)
          return;
        const candidate = request.input.candidates.find((item) => item.key === result.key);
        if (!candidate)
          throw new ChoiceError("Provider returned an invalid option key.", "protocol");
        const reachesLength =
          candidate.kind === "text" &&
          characterCount(this.task.state) + characterCount(candidate.value) > params.maxChars;
        const appended = candidate.kind === "text" && !reachesLength ? candidate.value : "";
        this.updateRound(id, {
          status: "success",
          response: result.response,
          optionKey: candidate.key,
          label: candidate.label,
          confidence: result.confidence,
          appended,
          durationMs: Date.now() - started,
          finishedAt: new Date().toISOString(),
        });
        if (appended) this.update({ state: this.task.state + appended });
        if (candidate.kind === "end") {
          this.finish(`模型选择结束标记 ${candidate.label}。`);
          return;
        }
        if (reachesLength) {
          this.finish("下一项会超过最大字符数，这一项没有追加。");
          return;
        }
        if (params.stopStrings.some((stop) => this.task.state.includes(stop))) {
          this.finish("命中停止字符串，正文包含停止字符串。");
          return;
        }
        if (this.isPausing()) {
          this.update({ status: "paused", reason: "已暂停。" });
          return;
        }
        if (this.task.runRounds >= params.maxRounds) {
          this.finish("达到最大轮数。");
          return;
        }
        await abortableDelay(params.intervalMs, signal);
      }
    } catch (error) {
      if (epoch !== this.epoch || signal.aborted) return;
      const message =
        error instanceof ChoiceError ? error.message : "生成器无法继续，请检查连接和配置。";
      this.update({ status: "error", reason: message });
    }
  }
}
