import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/domain";
import {
  connectionIdentity,
  loadCredentials,
  loadSettings,
  saveCredentials,
  saveSettings,
} from "@/lib/model-settings";
import { importTask, loadWorkspace, restoreTask, saveWorkspace } from "@/lib/task-storage";
import { WorkspaceStore } from "@/lib/workspace-store";
import { task } from "./helpers";

class BrowserStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
afterEach(() => vi.unstubAllGlobals());

describe("task persistence", () => {
  it("round-trips local tasks, parameters and vocabulary versions in IndexedDB", async () => {
    const value = task();
    value.state = " \\ \r\n\t";
    value.vocabulary.version = 3;
    const workspace = {
      version: 1 as const,
      tasks: [value],
      vocabularies: [value.vocabulary],
      activeId: value.id,
    };
    await saveWorkspace(workspace);
    expect(await loadWorkspace()).toEqual(workspace);
  });
  it("restores an interrupted task as paused without replaying requests", () => {
    const value = task();
    value.status = "running";
    const restored = restoreTask(value);
    expect(restored.status).toBe("paused");
    expect(restored.requests).toBe(0);
    expect(restored.reason).toContain("页面");
  });
  it("imports the exact state under a new identity", () => {
    const value = task();
    value.state = "\r\n\t\\";
    const imported = importTask(JSON.stringify(value));
    expect(imported.id).not.toBe(value.id);
    expect(imported.state).toBe(value.state);
  });
  it("keeps task vocabulary snapshots independent of library updates", () => {
    const value = task();
    const store = new WorkspaceStore({
      version: 1,
      tasks: [value],
      vocabularies: [value.vocabulary],
      activeId: value.id,
    });
    store.saveVocabulary({ ...value.vocabulary, version: 2, name: "Changed" });
    expect(store.active.getSnapshot().vocabulary.version).toBe(1);
    expect(store.getSnapshot().vocabularies[0].version).toBe(2);
    store.resetActive();
    expect(store.getSnapshot().tasks).toHaveLength(1);
    expect(store.active.getSnapshot().prompt).toBe("");
  });
});

describe("model settings and Token storage", () => {
  it("persists non-sensitive settings independently from opt-in credentials", () => {
    const local = new BrowserStorage();
    vi.stubGlobal("localStorage", local);
    saveSettings(DEFAULT_SETTINGS);
    saveCredentials({ token: "private-token", extraHeaders: { "X-Key": "header-secret" } }, false);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadCredentials().credentials.token).toBe("");
    expect(
      JSON.stringify([...Array(local.length)].map((_, index) => local.getItem(local.key(index)!))),
    ).not.toContain("private-token");
    saveCredentials({ token: "private-token", extraHeaders: { "X-Key": "header-secret" } }, true);
    expect(loadCredentials().credentials.token).toBe("private-token");
    expect(loadCredentials().saved).toBe(true);
    saveCredentials({ token: "private-token", extraHeaders: {} }, false);
    expect(loadCredentials().saved).toBe(false);
  });
  it("invalidates connection test identity after origin, Token, model, path or header changes", () => {
    const auth = { token: "token-one", extraHeaders: {} };
    const identity = connectionIdentity(DEFAULT_SETTINGS, auth);
    for (const patch of [
      { baseUrl: "https://new.example" },
      { model: "other-model" },
      { requestPath: "/v2/systemone" },
    ]) {
      expect(connectionIdentity({ ...DEFAULT_SETTINGS, ...patch }, auth)).not.toBe(identity);
    }
    expect(connectionIdentity(DEFAULT_SETTINGS, { ...auth, token: "token-two" })).not.toBe(
      identity,
    );
    expect(
      connectionIdentity(DEFAULT_SETTINGS, { ...auth, extraHeaders: { "X-Key": "changed" } }),
    ).not.toBe(identity);
  });
});
