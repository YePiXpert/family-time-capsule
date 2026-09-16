import { createContext, createElement, useContext, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalMemoryEdit, MemoryEditContent } from "../src/memories/edit-model";
import { resumableMemoryEdits, resumableMemoryEditTitle } from "../src/memories/resumable-edits";

const mocks = vi.hoisted(() => ({
  list: vi.fn<(scope: string) => Promise<LocalMemoryEdit[]>>(), listeners: new Set<() => void>(),
}));
const Focus = createContext(false);
vi.mock("../src/memories/edit-store", () => ({
  listMemoryEdits: mocks.list,
  subscribeMemoryEdits: (listener: () => void) => { mocks.listeners.add(listener); return () => { mocks.listeners.delete(listener); }; },
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const focused = useContext(Focus);
    useEffect(() => focused ? effect() : undefined, [effect, focused]);
  },
}));
const { useResumableMemoryEdits } = await import("../src/memories/use-resumable-edits");

const identity = ["https://family.invalid", "instance-a", "owner-a", "family-a"];
const scopeA = JSON.stringify(identity), scopeB = JSON.stringify(identity.with(2, "owner-b"));
const base: MemoryEditContent = { title: "游泳", bodyText: "第一次下水", location: "", occurredAt: null, precision: "unknown", participants: [], child: null };
function edit(memoryId: string, patch: Partial<LocalMemoryEdit> = {}): LocalMemoryEdit {
  return { scope: scopeA, memoryId, content: { ...base, bodyText: "第一次下水，补到一半" }, base, baseRevision: 2, timezone: "UTC",
    savedContent: null, submission: null, conflict: null, blocked: false, problem: null, revision: 1, updatedAt: "2026-09-16T00:00:00.000Z", ...patch };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("resumable server supplements", () => {
  it("omits merely opened or acknowledged rows and includes pending, conflicting and metadata-only work", () => {
    const rows = [
      edit("opened", { content: base }), edit("acknowledged", { content: base, appliedItemIds: ["already-applied"] }),
      edit("acknowledged-saved", { content: base, savedContent: base }),
      edit("typing"), edit("blocked", { blocked: true, problem: "需要核对权限" }),
      edit("pending", { content: base, savedContent: { ...base, bodyText: "此前保存待传的内容" } }),
      edit("receipt", { content: base, submission: { mutationId: "save-once", content: base, expectedRevision: 1 } }),
      edit("conflict", { content: base, conflict: { content: base, revision: 3 } }),
      edit("metadata", { content: { ...base, milestoneType: "first_time" } }),
    ];
    expect(resumableMemoryEdits(rows, scopeA).map(row => row.memoryId)).toEqual(["blocked", "conflict", "metadata", "pending", "receipt", "typing"]);
  });

  it("isolates server, installation, owner and family; orders newest first without mutating source", () => {
    const others = identity.map((_, index) => edit(`other-${index}`, { scope: JSON.stringify(identity.with(index, "different")) }));
    const rows = Object.freeze([edit("older", { updatedAt: "2026-09-15T00:00:00.000Z" }), edit("z"), edit("a"), ...others, edit("local", { scope: "local" })]);
    expect(resumableMemoryEdits(rows, scopeA).map(row => row.memoryId)).toEqual(["a", "z", "older"]);
    expect(resumableMemoryEdits(rows, "local")).toEqual([]);
    expect(rows[0]!.memoryId).toBe("older");
    expect(resumableMemoryEditTitle(edit("title", { content: { ...base, title: "  小名  " } }))).toBe("小名");
    expect(resumableMemoryEditTitle(edit("body", { content: { ...base, title: "", bodyText: ` ${"字".repeat(80)} ` } }))).toBe("字".repeat(60));
    expect(resumableMemoryEditTitle(edit("metadata", { content: { ...base, title: "", bodyText: "", visibility: "private" } }))).toBe("这段回忆");
  });
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
function Hook({ scope, enabled }: { scope: string | null; enabled: boolean }) {
  return createElement("EditResumeState", { value: useResumableMemoryEdits(scope, enabled) });
}
async function render(scope: string | null, enabled = true, focused = true) {
  const node = createElement(Focus.Provider, { value: focused }, createElement(Hook, { scope, enabled }));
  await act(async () => { if (tree) tree.update(node); else tree = create(node); });
}
function state(): ReturnType<typeof useResumableMemoryEdits> { return tree!.root.findByType("EditResumeState" as never).props.value; }
async function changed() { await act(async () => { for (const listener of mocks.listeners) listener(); }); }
beforeEach(() => { mocks.list.mockReset(); mocks.listeners.clear(); });
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; });

describe("home supplement recovery", () => {
  it("reads while focused, refreshes on re-entry and immediately removes an acknowledged supplement", async () => {
    mocks.list.mockResolvedValueOnce([edit("story")]).mockResolvedValueOnce([edit("story", { content: base })]).mockResolvedValueOnce([edit("new-typing")]);
    await render(scopeA, true, false);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.listeners.size).toBe(0);
    await render(scopeA);
    expect(state()?.rows[0]?.memoryId).toBe("story");
    await changed();
    expect(state()?.rows).toEqual([]);
    await render(scopeA, true, false);
    expect(mocks.listeners.size).toBe(0);
    await render(scopeA);
    expect(state()?.rows[0]?.memoryId).toBe("new-typing");
    expect(mocks.list.mock.calls).toEqual([[scopeA], [scopeA], [scopeA]]);
  });

  it.each(["resolve", "reject"] as const)("hides the previous owner before the next read and ignores its late %s", async late => {
    const old = deferred<LocalMemoryEdit[]>(), current = deferred<LocalMemoryEdit[]>();
    mocks.list.mockResolvedValueOnce([edit("old")]).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await render(scopeA); await changed(); await render(scopeB);
    expect(state()).toBeNull();
    await act(async () => current.resolve([edit("new", { scope: scopeB }), edit("wrong-scope")]));
    await act(async () => late === "resolve" ? old.resolve([edit("late-private")]) : old.reject(new Error("old error")));
    expect(state()).toMatchObject({ scope: scopeB, rows: [{ memoryId: "new" }], error: null });
    expect(mocks.listeners.size).toBe(1);
  });

  it.each([null, "local", "no-permission"])("hides private writing for %s and cancels its pending read", async unavailable => {
    const pending = deferred<LocalMemoryEdit[]>();
    mocks.list.mockResolvedValueOnce([edit("private")]).mockReturnValueOnce(pending.promise);
    await render(scopeA); await changed();
    await render(unavailable === "no-permission" ? scopeA : unavailable, unavailable !== "no-permission");
    expect(state()).toBeNull(); expect(mocks.listeners.size).toBe(0);
    await act(async () => pending.resolve([edit("late-private")]));
    expect(state()).toBeNull(); expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("ignores a pre-receipt read that finishes after a newer clean snapshot", async () => {
    const stale = deferred<LocalMemoryEdit[]>();
    mocks.list.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([edit("acknowledged", { content: base })]);
    await render(scopeA); await changed();
    expect(state()?.rows).toEqual([]);
    await act(async () => stale.resolve([edit("acknowledged")]));
    expect(state()?.rows).toEqual([]);
  });

  it("clears stale titles after a storage error and recovers on the next local write", async () => {
    mocks.list.mockResolvedValueOnce([edit("story")]).mockRejectedValueOnce(new Error("disk failure")).mockResolvedValueOnce([edit("recovered")]);
    await render(scopeA); await changed();
    expect(state()?.rows).toEqual([]); expect(state()?.error).toContain("暂时无法读取");
    await changed();
    expect(state()).toMatchObject({ rows: [{ memoryId: "recovered" }], error: null });
  });
});
