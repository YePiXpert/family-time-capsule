import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutoSync, sharedChanged, useAutoSync } from "../src/sync/auto";
import { emptyLibrary, emptyContent } from "../src/local/model";
import { LocalStore } from "../src/local/store";
import { getToken } from "../src/family/session";
import { loadKey, readRemoteState, writeRemoteState } from "../src/sync/state";
import { SyncError } from "../src/sync/transport";
import { runFamilySync } from "../src/sync/family";
import { isLocalBusy, isSyncRunning, markSyncRunning } from "../src/sync/status";

const native = vi.hoisted(() => ({
  effect: undefined as (() => () => void) | undefined,
  change: undefined as ((state: string) => void) | undefined,
  state: "active",
  remove: vi.fn(),
}));
vi.mock("react", () => ({ useEffect: (fn: () => () => void) => { native.effect = fn; } }));
vi.mock("react-native", () => ({ AppState: {
  get currentState() { return native.state; },
  addEventListener: (_: string, fn: (state: string) => void) => {
    native.change = fn;
    return { remove: native.remove };
  },
} }));
vi.mock("../src/family/session", () => ({ getToken: vi.fn() }));
vi.mock("../src/sync/state", () => ({ loadKey: vi.fn(), readRemoteState: vi.fn(), writeRemoteState: vi.fn() }));
vi.mock("../src/sync/family", () => ({ runFamilySync: vi.fn() }));
vi.mock("../src/sync/status", () => {
  const isSyncRunning = vi.fn(), markSyncRunning = vi.fn();
  // 与真实 claimSync 同义：空闲才占住。
  const claimSync = vi.fn(() => (isSyncRunning() ? false : (markSyncRunning(true), true)));
  return { isLocalBusy: vi.fn(), isSyncRunning, markSyncRunning, claimSync };
});
vi.mock("../src/sync/transport", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/sync/transport")>(),
  createTransport: () => ({}),
}));

function store() {
  return new LocalStore({ read: async () => null, write: async () => {} });
}
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const deps = {
    store: store(),
    ready: vi.fn(async () => true),
    isBusy: vi.fn(() => false),
    run: vi.fn(async (_signal: AbortSignal): Promise<unknown> => undefined),
    onError: vi.fn(),
  };
  return { ...deps, auto: createAutoSync(deps) };
}
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); native.state = "active"; });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const tick = () => vi.advanceTimersByTimeAsync(0);

describe("自动同步排期", () => {
  it("回前台通过就绪门后立即跑；未就绪不跑", async () => {
    const { auto, ready, run } = setup();
    auto.onForeground();
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    ready.mockResolvedValue(false);
    auto.onForeground();
    auto.onLibraryChange();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("同步中取定上传那一版之后的改动，结束后补排一轮；之前的（含合并写入）不补", async () => {
    const { auto, run } = setup();
    const task = deferred();
    run.mockReturnValueOnce(task.promise);
    auto.onForeground();
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    // 合并写入本机：在取定上传之前，随这一轮一起传走。
    auto.onLibraryChange();
    auto.snapshotTaken();
    task.resolve();
    await tick();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(1);
    // 第二轮：取定之后她又改了一处，这一轮带不走。
    const second = deferred();
    run.mockReturnValueOnce(second.promise);
    auto.onForeground();
    await tick();
    auto.snapshotTaken();
    auto.onLibraryChange();
    second.resolve();
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("连续五次保存从最后一次起防抖 30 秒，只跑一次", async () => {
    const { auto, run } = setup();
    for (let i = 0; i < 5; i++) {
      auto.onLibraryChange();
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await vi.advanceTimersByTimeAsync(24_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("已有保存排期时回前台，前台任务未结束则到点只顺延", async () => {
    const { auto, run } = setup();
    const task = deferred();
    run.mockReturnValueOnce(task.promise);
    auto.onLibraryChange();
    auto.onForeground();
    await tick();
    auto.onForeground();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    task.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("手动同步或本机操作忙时前台跳过，保存仅用一个计时器每 30 秒顺延", async () => {
    const { auto, run, isBusy } = setup();
    isBusy.mockReturnValue(true);
    auto.onForeground();
    expect(vi.getTimerCount()).toBe(0);
    auto.onLibraryChange();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(run).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
    }
    isBusy.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("异步就绪检查也单飞，检查后重新确认忙碌门", async () => {
    const { auto, run, ready, isBusy } = setup();
    const check = deferred<boolean>();
    ready.mockReturnValueOnce(check.promise);
    auto.onForeground();
    auto.onForeground();
    expect(ready).toHaveBeenCalledTimes(1);
    isBusy.mockReturnValue(true);
    check.resolve(true);
    await tick();
    expect(run).not.toHaveBeenCalled();
  });
  it("保存的就绪检查期间变忙仍顺延", async () => {
    const { auto, run, ready, isBusy } = setup();
    const check = deferred<boolean>();
    ready.mockReturnValueOnce(check.promise);
    auto.onLibraryChange();
    await vi.advanceTimersByTimeAsync(30_000);
    isBusy.mockReturnValue(true);
    check.resolve(true);
    await tick();
    expect(vi.getTimerCount()).toBe(1);
    isBusy.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("自动同步自己写库的通知在取定上传之前，不在结束后再排期", async () => {
    const { auto, run } = setup();
    const task = deferred();
    run.mockReturnValueOnce(task.promise);
    auto.onForeground();
    await tick();
    auto.onLibraryChange();
    auto.snapshotTaken();
    task.resolve();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("后台清排期、abort，CANCELED 不报错，回前台可再跑", async () => {
    const { auto, run, onError } = setup();
    run.mockImplementationOnce((signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("已停止。"), { code: "CANCELED" })));
    }));
    auto.onLibraryChange();
    auto.onForeground();
    await tick();
    auto.onBackground();
    expect(run.mock.calls[0]![0].aborted).toBe(true);
    auto.onLibraryChange();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    auto.onForeground();
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("后台取消尚未通过的就绪检查", async () => {
    const { auto, run, ready } = setup();
    const check = deferred<boolean>();
    ready.mockReturnValueOnce(check.promise);
    auto.onForeground();
    auto.onBackground();
    check.resolve(true);
    await tick();
    expect(run).not.toHaveBeenCalled();
  });
  it("运行失败将原始错误交给 onError，之后可再次触发", async () => {
    const { auto, run, onError } = setup();
    const error = new Error("现在连不上服务，请稍后再试。");
    run.mockRejectedValueOnce(error);
    auto.onForeground();
    await tick();
    expect(onError.mock.calls[0]![0]).toBe(error);
    auto.onForeground();
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("错误落盘失败也不产生未处理拒绝", async () => {
    const { auto, run, onError } = setup();
    const error = new Error("ENOSPC");
    run.mockRejectedValueOnce(error);
    onError.mockRejectedValueOnce(new Error("ENOSPC"));
    auto.onForeground();
    await tick();
    expect(onError.mock.calls[0]![0]).toBe(error);
    auto.onForeground();
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("dispose 清排期并 abort，任何后续触发无效", async () => {
    const { auto, run } = setup();
    const task = deferred();
    run.mockReturnValueOnce(task.promise);
    auto.onLibraryChange();
    auto.onForeground();
    await tick();
    auto.dispose();
    expect(run.mock.calls[0]![0].aborted).toBe(true);
    task.resolve();
    auto.onForeground();
    auto.onBackground();
    auto.onLibraryChange();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("共享内容的引用比较", () => {
  it("records 换引用即触发（编辑而非仅新增也适用）", () => {
    const prev = emptyLibrary();
    expect(sharedChanged(prev, { ...prev, records: { ...prev.records } })).toBe(true);
  });
  it("只有 drafts、settings 变化不触发", () => {
    const prev = emptyLibrary();
    expect(sharedChanged(prev, { ...prev, drafts: {}, settings: { ...prev.settings, largeText: true } })).toBe(false);
  });
  it("tombstones 换引用会触发", () => {
    const prev = emptyLibrary();
    expect(sharedChanged(prev, { ...prev, tombstones: {} })).toBe(true);
  });
  it("真实 store 保存草稿与设置保留共享引用，改资料和年度寄语仍能识别", async () => {
    const local = store();
    await local.open();
    const before = local.get();
    await local.change((s) => {
      s.drafts.d = { id: "d", recordId: null, baseRevision: 0, updatedAt: new Date().toISOString(), content: emptyContent() };
      s.settings.largeText = true;
    });
    expect(sharedChanged(before, local.get())).toBe(false);
    await local.change((s) => { s.profile.name = "桉桉"; s.yearNotes["2026"] = "给你"; });
    expect(sharedChanged(before, local.get())).toBe(true);
    const after = local.get();
    await local.change((s) => { s.settings.theme = "dark"; });
    expect(sharedChanged(after, local.get())).toBe(false);
  });
});

function Mount() {
  vi.mocked(getToken).mockResolvedValue("token");
  vi.mocked(readRemoteState).mockResolvedValue({ version: 2, enabled: true, autoSync: true, keyId: "a".repeat(16), joinedAt: "2026-09-21T00:00:00Z", seen: {} });
  vi.mocked(loadKey).mockResolvedValue(new Uint8Array(32));
  const local = store();
  useAutoSync(local);
  return { local, cleanup: native.effect!() };
}
describe("App 生命周期接线", () => {
  it("inactive 不停止正在运行的同步也不清保存排期，background 才停止", async () => {
    const { local, cleanup } = Mount();
    const task = deferred<Awaited<ReturnType<typeof runFamilySync>>>();
    vi.mocked(runFamilySync).mockReturnValueOnce(task.promise);
    await local.change((s) => { s.profile.name = "桉桉"; });
    await vi.advanceTimersByTimeAsync(2_000);
    const signal = vi.mocked(runFamilySync).mock.calls[0]![1].signal!;
    expect(vi.getTimerCount()).toBe(1);
    native.change!("inactive");
    expect(signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(28_000);
    expect(runFamilySync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    native.change!("background");
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    task.resolve((await readRemoteState())!);
    await tick();
    cleanup();
  });
  it("inactive 事件保留冷启动排期", async () => {
    const { cleanup } = Mount();
    native.change!("inactive");
    expect(vi.getTimerCount()).toBe(1);
    native.state = "inactive";
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runFamilySync).not.toHaveBeenCalled();
    native.state = "active";
    native.change!("active");
    await tick();
    expect(runFamilySync).toHaveBeenCalledOnce();
    cleanup();
  });
  it.each(["inactive", "background"])("挂载时 %s 只有 background 会阻止保存排期", async (state) => {
    native.state = state;
    const { local, cleanup } = Mount();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runFamilySync).not.toHaveBeenCalled();
    await local.change((s) => { s.profile.name = "桉桉"; });
    expect(vi.getTimerCount()).toBe(state === "inactive" ? 1 : 0);
    cleanup();
  });
  it.each(["NETWORK", "TIMEOUT", "INCOMPLETE"])("暂时失败 %s 不写 lastError，下次回前台仍可重试", async (code) => {
    const { cleanup } = Mount();
    vi.mocked(runFamilySync).mockRejectedValueOnce(new SyncError(code, "现在连不上服务。"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(writeRemoteState).not.toHaveBeenCalled();
    expect(markSyncRunning).toHaveBeenLastCalledWith(false);
    native.change!("active");
    await tick();
    expect(runFamilySync).toHaveBeenCalledTimes(2);
    cleanup();
  });
  it.each([
    new SyncError("AUTH_REQUIRED", "请先登录。"),
    new Error("磁盘满"),
  ])("其他失败写入 lastError：%s", async (error) => {
    const { cleanup } = Mount();
    const state = await readRemoteState();
    vi.mocked(runFamilySync).mockRejectedValueOnce(error);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(writeRemoteState).toHaveBeenCalledExactlyOnceWith({ ...state, lastError: error.message });
    expect(markSyncRunning).toHaveBeenLastCalledWith(false);
    cleanup();
  });
  it("冷启动等两秒，保存后等 30 秒，退订后不再跑", async () => {
    const { local, cleanup } = Mount();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(runFamilySync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runFamilySync).toHaveBeenCalledTimes(1);
    expect(markSyncRunning).toHaveBeenNthCalledWith(1, true);
    expect(markSyncRunning).toHaveBeenNthCalledWith(2, false);
    await local.change((s) => { s.settings.largeText = true; });
    expect(vi.getTimerCount()).toBe(0);
    await local.change((s) => { s.profile.name = "桉桉"; });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runFamilySync).toHaveBeenCalledTimes(2);
    cleanup();
    expect(native.remove).toHaveBeenCalledOnce();
    await local.change((s) => { s.profile.name = "她"; });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("启动时进后台会取消冷启动任务，回前台立即跑", async () => {
    const { cleanup } = Mount();
    native.change!("background");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runFamilySync).not.toHaveBeenCalled();
    native.change!("active");
    await tick();
    expect(runFamilySync).toHaveBeenCalledOnce();
    cleanup();
  });
  it.each(["token", "joined", "toggle", "key", "key-error", "local-busy", "sync-busy"])("%s 门未通过不启动", async (gate) => {
    const { cleanup } = Mount();
    if (gate === "token") vi.mocked(getToken).mockResolvedValue(null);
    if (gate === "key") vi.mocked(loadKey).mockResolvedValue(null);
    if (gate === "key-error") vi.mocked(loadKey).mockRejectedValue(new Error("locked"));
    if (gate === "local-busy") vi.mocked(isLocalBusy).mockReturnValue(true);
    if (gate === "sync-busy") vi.mocked(isSyncRunning).mockReturnValue(true);
    if (gate === "joined" || gate === "toggle") {
      const remote = await readRemoteState();
      vi.mocked(readRemoteState).mockResolvedValue({ ...remote!, [gate === "joined" ? "enabled" : "autoSync"]: false });
    }
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runFamilySync).not.toHaveBeenCalled();
    expect(writeRemoteState).not.toHaveBeenCalled();
    cleanup();
  });
  it("失败写入 lastError 并清运行标志，状态已删除则不写", async () => {
    const { cleanup } = Mount();
    vi.mocked(runFamilySync).mockRejectedValueOnce(new Error("现在连不上服务。"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(writeRemoteState).toHaveBeenCalledWith(expect.objectContaining({ lastError: "现在连不上服务。" }));
    expect(markSyncRunning).toHaveBeenLastCalledWith(false);
    vi.mocked(writeRemoteState).mockClear();
    vi.mocked(runFamilySync).mockImplementationOnce(async () => {
      vi.mocked(readRemoteState).mockResolvedValue(null);
      throw new Error("已退出。");
    });
    native.change!("active");
    await tick();
    expect(writeRemoteState).not.toHaveBeenCalled();
    cleanup();
  });
});


it("yearPicks changes trigger sync; a real store draft save preserves the directory reference", async () => {
  const local = store(); await local.open(); const before = local.get();
  await local.change(s => { s.yearPicks = { "2026": { months: { "2026-09": { recordIds: ["r"] } }, updatedAt: "2026-09-21T10:00:00Z" } }; });
  expect(sharedChanged(before, local.get())).toBe(true);
  const picked = local.get();
  await local.change(s => { s.drafts.d = { id: "d", recordId: null, baseRevision: 0, updatedAt: "2026-09-21T10:00:00Z", content: emptyContent() }; });
  expect(local.get().yearPicks).toBe(picked.yearPicks);
  expect(sharedChanged(picked, local.get())).toBe(false);
  await local.change(s => { delete s.yearPicks; });
  expect(sharedChanged(picked, local.get())).toBe(true);
});
