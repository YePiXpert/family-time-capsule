import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { SyncCard } from "../src/sync/SyncCard";

const env = vi.hoisted(() => ({
  running: false,
  isRunning: vi.fn(),
  localBusy: vi.fn(),
  slots: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
  alerts: [] as unknown[],
  sync: vi.fn(), join: vi.fn(), mark: vi.fn(), key: new Uint8Array(32), records: {} as Record<string, unknown>,
  navigate: vi.fn(), write: vi.fn(), current: null as unknown,
  // 同步状态里除 running 以外的字段，与每次渲染登记的 useEffect（回调 + 依赖）。
  status: {} as { lastSyncAt?: string; lastError?: string; conflicts?: number },
  effects: [] as { effect: () => void | (() => void); deps?: unknown[] }[],
  readRemote: vi.fn(), readConflicts: vi.fn(), conflictItems: [] as unknown[],
}));
vi.mock("react", () => ({
  useState: () => {
    const setter = vi.fn();
    env.setters.push(setter);
    return [env.slots.shift(), setter];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => { env.effects.push({ effect, deps }); },
  useRef: () => ({ current: null }),
}));
vi.mock("react-native", () => ({ View: "View", Switch: "Switch", StyleSheet: { hairlineWidth: 1 }, Alert: { alert: (...args: unknown[]) => env.alerts.push(args) } }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: vi.fn() }));
vi.mock("../src/local/backup", () => ({ BackupStopped: class extends Error {} }));
vi.mock("../src/local/context", () => ({ useLibrary: () => ({ settings: {}, records: env.records }), useStore: () => ({}), useSyncStatus: () => ({ running: env.running, ...env.status }) }));
vi.mock("../src/local/navigation", () => ({ useNav: () => ({ navigate: env.navigate }) }));
vi.mock("../src/local/ui", () => ({ Button: "Button", Card: "Card", ErrorText: "ErrorText", Text: "Text", messageOf: String, useStyles: () => ({}), useTheme: () => ({ colors: {} }) }));
vi.mock("../src/sync/crypto", () => ({ keyIdOf: () => "K" }));
vi.mock("../src/sync/family", () => ({ runFamilySync: env.sync, startSharing: env.join }));
vi.mock("../src/sync/status", () => ({
  markSyncRunning: env.mark,
  isLocalBusy: env.localBusy,
  claimSync: () => (env.isRunning() ? false : (env.mark(true), true)),
}));
vi.mock("../src/sync/state", () => ({
  loadKey: async () => env.key, readRemoteState: () => env.readRemote(), readConflicts: () => env.readConflicts(),
  writeRemoteState: env.write,
  unreadNotice: (summary?: { unread?: number }) => (summary?.unread ? `有 ${summary.unread} 台手机的内容这次没读到` : ""),
}));
vi.mock("../src/sync/transport", () => ({
  SyncError: class extends Error {},
  createTransport: () => ({}),
}));

type Element = { type?: unknown; props?: { testID?: string; title?: string; disabled?: boolean; message?: string; children?: unknown; onPress?: () => void; onValueChange?: (value: boolean) => void; value?: boolean } };
function nodes(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const element = node as Element;
  return [element, ...nodes(element.props?.children)];
}
const find = (tree: unknown, id: string) => nodes(tree).find((el) => el.props?.testID === id);
function text(tree: unknown): string {
  if (typeof tree === "string") return tree;
  if (Array.isArray(tree)) return tree.map(text).join("");
  return tree && typeof tree === "object" ? text((tree as Element).props?.children) : "";
}
const MESSAGE = 2;
function render(options: { remote?: unknown; status?: unknown; keyId?: string | null; conflicts?: number; lastError?: string } = {}) {
  const { status = null, keyId = "K", conflicts = 0, lastError = "" } = options;
  // remote 要能显式传 undefined（还在读），不能用解构默认值。
  const remote = "remote" in options ? options.remote : { enabled: true, keyId: "a".repeat(16) };
  // useState 槽位：remote、progress、message、error、conflicts、localKeyId、status、statusError、savingAutoSync。
  const state = remote && typeof remote === "object" ? { ...remote, ...(lastError ? { lastError } : {}) } : remote;
  env.slots = [state, "", "", "", conflicts, keyId, status, "", false];
  env.setters = [];
  env.effects = [];
  return SyncCard({ busy: false });
}
const notStarted = (status: unknown, keyId: string | null = "K") => render({ remote: null, status, keyId });
beforeEach(() => {
  vi.clearAllMocks(); env.alerts = []; env.records = {};
  env.running = false; env.current = null;
  env.status = {}; env.conflictItems = [];
  env.readRemote.mockImplementation(async () => env.current);
  env.readConflicts.mockImplementation(async () => env.conflictItems);
  env.isRunning.mockReturnValue(false);
  env.localBusy.mockReturnValue(false);
  env.sync.mockResolvedValue({ lastSyncSummary: { pulled: 2, pushed: 1, conflicts: 0 } });
  env.join.mockResolvedValue({});
});
it("同步卡只管同步：维护、退出与恢复码都不在这里", () => {
  const source = readFileSync(new URL("../src/sync/SyncCard.tsx", import.meta.url), "utf8");
  for (const forbidden of ["wipeFamily", "verifyRemoteBackup", "leaveFamily(", "RecoveryCode", "clearSyncFiles", "keyId.slice", "Alert."])
    expect(source).not.toContain(forbidden);
  const tree = render();
  for (const id of ["remote-verify", "remote-wipe-family", "remote-family", "remote-enable", "remote-resume"]) expect(find(tree, id)).toBeUndefined();
  expect(find(tree, "remote-backup")).toBeDefined();
  expect(find(tree, "auto-sync-toggle")).toBeDefined();
});
it("现在同步接入 runFamilySync，并在结束后清掉运行标志", async () => {
  find(render(), "remote-backup")!.props!.onPress!();
  await vi.waitFor(() => expect(env.mark).toHaveBeenLastCalledWith(false));
  expect(env.sync).toHaveBeenCalledOnce();
  expect(env.sync).toHaveBeenCalledWith({}, { transport: expect.any(Object), key: env.key, onProgress: expect.any(Function), signal: expect.any(AbortSignal) });
  expect(env.mark.mock.calls).toEqual([[true], [false]]);
});
it("只有冲突的同步结果说明两台手机都改过，不显示已经最新", async () => {
  env.sync.mockResolvedValueOnce({ lastSyncSummary: { pulled: 0, pushed: 0, conflicts: 1 } });
  find(render(), "remote-backup")!.props!.onPress!();
  const setMessage = env.setters[MESSAGE]!;
  await vi.waitFor(() => expect(setMessage).toHaveBeenLastCalledWith(expect.stringContaining("1 段两台手机都改过")));
  expect(setMessage.mock.calls.at(-1)![0]).not.toContain("最新");
});
it("有手机没读成时同步结果照实说出来", async () => {
  env.sync.mockResolvedValueOnce({ lastSyncSummary: { pulled: 1, pushed: 0, conflicts: 0, unread: 1 } });
  find(render(), "remote-backup")!.props!.onPress!();
  const setMessage = env.setters[MESSAGE]!;
  await vi.waitFor(() => expect(setMessage).toHaveBeenLastCalledWith(expect.stringContaining("有 1 台手机的内容这次没读到")));
  expect(setMessage.mock.calls.at(-1)![0]).toContain("并入 1 处改动");
});
it("本机状态未读完时只有标题与正在读取，没有按钮", () => {
  const tree = render({ remote: undefined });
  expect(nodes(tree).filter((el) => el.type === "Button" || el.type === "Switch")).toEqual([]);
  expect(nodes(tree).filter((el) => el.type === "Text").map((el) => el.props?.children)).toEqual(["同步", "正在读取…"]);
});
it("已加入、还没同步：一套说法，按钥匙与远端状态给唯一的下一步", () => {
  const asking = notStarted(null);
  expect(text(asking)).toContain("已加入，还没完成第一次同步。");
  expect(text(asking)).toContain("正在看看家里有没有人在写");
  expect(nodes(asking).filter((el) => el.type === "Button")).toEqual([]);
  const noKey = notStarted({ manifests: 2, keyId: "x" }, null);
  expect(nodes(noKey).filter((el) => el.type === "Button")).toEqual([]);
  expect(nodes(noKey).find((el) => el.type === "ErrorText" && el.props?.message)!.props!.message).toContain("退出家庭后重新加入");
  const mismatch = notStarted({ manifests: 2, keyId: "x" });
  expect(nodes(mismatch).filter((el) => el.type === "Button")).toEqual([]);
  expect(nodes(mismatch).find((el) => el.type === "ErrorText" && el.props?.message)!.props!.message).toContain("对不上");
  const first = notStarted({ manifests: 0, keyId: null });
  expect(find(first, "remote-first-sync")!.props!.title).toBe("开始第一次同步");
  expect(text(first)).toContain("家里还没有人同步过");
  expect(find(first, "auto-sync-toggle")).toBeUndefined();
  for (const forbidden of ["开始一起写", "加入一起写", "家人一起写"]) expect(text(first)).not.toContain(forbidden);
});
it("家里已有人在写、这台又有记录：按钮前先说清合并几段、先留本机备份，按了就开始", async () => {
  env.records = { a: {}, b: {}, c: {} };
  const tree = notStarted({ manifests: 2, keyId: "K" });
  expect(text(tree)).toContain("已有的 3 段时光和家人的合在一起");
  expect(text(tree)).toContain("本机留一份备份");
  find(tree, "remote-first-sync")!.props!.onPress!();
  await vi.waitFor(() => expect(env.mark).toHaveBeenLastCalledWith(false));
  expect(env.join).toHaveBeenCalledWith({}, env.key, { transport: expect.any(Object), onProgress: expect.any(Function), signal: expect.any(AbortSignal) });
  expect(env.mark.mock.calls).toEqual([[true], [false]]);
  expect(env.alerts).toEqual([]);
});
it("同步失败也会清掉运行标志", async () => {
  env.sync.mockRejectedValueOnce(new Error("离线"));
  find(render(), "remote-backup")!.props!.onPress!();
  await vi.waitFor(() => expect(env.mark).toHaveBeenLastCalledWith(false));
  expect(env.mark.mock.calls).toEqual([[true], [false]]);
});
it("自动同步时说明进度、禁用所有动作并隐藏旧错误，没有停止入口", () => {
  env.running = true;
  const tree = render({ conflicts: 1, lastError: "上次失败" });
  expect(find(tree, "remote-backup")!.props).toMatchObject({ title: "正在同步…", disabled: true });
  expect(nodes(tree).filter((el) => el.type === "Button").every((el) => el.props?.disabled)).toBe(true);
  expect(nodes(tree).filter((el) => el.type === "ErrorText").map((el) => el.props?.message)).toEqual([""]);
  expect(find(tree, "remote-stop")).toBeUndefined();
});
it("未自动同步时保留现在同步标题和旧错误", () => {
  const tree = render({ lastError: "上次失败" });
  expect(find(tree, "remote-backup")!.props).toMatchObject({ title: "现在同步", disabled: false });
  expect(nodes(tree).find((el) => el.type === "ErrorText")!.props?.message).toBe("上次失败");
});
it("自动同步时第一次同步的入口也禁用", () => {
  env.running = true;
  expect(find(notStarted({ manifests: 2, keyId: "K" }), "remote-first-sync")!.props?.disabled).toBe(true);
});
it("同步守卫：别处在同步或本机在备份时说明原因，不启动", () => {
  const tree = render();
  env.isRunning.mockReturnValue(true);
  find(tree, "remote-backup")!.props!.onPress!();
  expect(env.setters[MESSAGE]).toHaveBeenCalledWith("正在同步，等它完成再试。");
  env.isRunning.mockReturnValue(false);
  env.localBusy.mockReturnValue(true);
  find(render(), "remote-backup")!.props!.onPress!();
  expect(env.setters[MESSAGE]).toHaveBeenCalledWith("本机正在备份或恢复，等它完成再试。");
  expect(env.sync).not.toHaveBeenCalled();
  expect(env.mark).not.toHaveBeenCalled();
});
it("自动同步开关在同步卡里，改的是本机同步状态", async () => {
  env.current = { enabled: true, keyId: "k", autoSync: false };
  const toggle = find(render({ remote: env.current }), "auto-sync-toggle")!;
  expect(toggle.props!.value).toBe(false);
  toggle.props!.onValueChange!(true);
  await vi.waitFor(() => expect(env.write).toHaveBeenCalledWith({ enabled: true, keyId: "k", autoSync: true }));
});

// #8：家庭页开着时后台同步跑完，卡上的上次同步、错误与冲突数要跟着变。
const REMOTE = 0, CONFLICTS = 4;
/** 只跑依赖比上一次渲染变了的 effect（不含挂载时就跑的），返回它们的清理函数。 */
function runChanged(before: typeof env.effects, after: typeof env.effects) {
  return after.flatMap(({ effect, deps }, i) => {
    const prev = before[i]?.deps;
    const changed = !deps || !prev || deps.length !== prev.length || deps.some((d, j) => !Object.is(d, prev[j]));
    const cleanup = changed ? effect() : undefined;
    return cleanup ? [cleanup] : [];
  });
}
/** 先按旧状态渲染一次，再换成新的同步状态重绘，只让变了依赖的 effect 跑。 */
function syncStatusChanges(
  from: { running?: boolean } & typeof env.status,
  to: { running?: boolean } & typeof env.status,
  options: Parameters<typeof render>[0] = {},
) {
  env.running = !!from.running; env.status = { ...from };
  render(options);
  const before = env.effects;
  env.running = !!to.running; env.status = { ...to };
  render(options);
  return runChanged(before, env.effects);
}
/** 把 effect 交给 setRemote／setConflicts 的值套到旧值上，按新值重绘。 */
function applied(old: unknown, oldConflicts = 0) {
  const setRemote = env.setters[REMOTE]!.mock.calls.at(-1)?.[0];
  const next = typeof setRemote === "function" ? setRemote(old) : old;
  const conflicts = env.setters[CONFLICTS]!.mock.calls.at(-1)?.[0] ?? oldConflicts;
  return { remote: next, conflicts: conflicts as number };
}
const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const synced = (day: number, more: object = {}) => ({ enabled: true, keyId: "K", lastSyncAt: at(day), lastSyncSummary: { devices: 2, bytes: 0 }, ...more });

it("#8 页面开着时自动同步跑完：重读远端状态与冲突，卡上换成新的上次同步与冲突数", async () => {
  const { dateTimeLabel } = await import("../src/local/dates");
  const old = synced(20);
  env.current = synced(25);
  env.conflictItems = [{}, {}];
  syncStatusChanges({ running: true, lastSyncAt: at(20), conflicts: 0 }, { running: false, lastSyncAt: at(25), conflicts: 2 }, { remote: old });
  await vi.waitFor(() => expect(env.setters[CONFLICTS]).toHaveBeenCalledWith(2));
  expect(env.readRemote).toHaveBeenCalledOnce();
  expect(env.readConflicts).toHaveBeenCalledOnce();
  const tree = render(applied(old));
  expect(text(tree)).toContain(`上次同步 ${dateTimeLabel(at(25))}`);
  expect(text(tree)).not.toContain(dateTimeLabel(at(20)));
  expect(text(tree)).toContain("有 2 段两台手机都改过");
  expect(find(tree, "remote-conflicts")).toBeDefined();
});
it("#8 自动同步出错：不必离开页面，新错误就显示在卡上", async () => {
  const old = synced(20);
  env.current = synced(20, { lastError: "服务连不上" });
  syncStatusChanges({ running: true, lastSyncAt: at(20) }, { running: false, lastSyncAt: at(20), lastError: "服务连不上" }, { remote: old });
  await vi.waitFor(() => expect(env.setters[REMOTE]).toHaveBeenCalled());
  const tree = render(applied(old));
  expect(nodes(tree).find((el) => el.type === "ErrorText")!.props?.message).toBe("服务连不上");
});
it("#8 上次同步、错误、冲突数任何一项变了都重读一次", async () => {
  for (const change of [{ lastSyncAt: at(25) }, { lastError: "离线" }, { conflicts: 3 }]) {
    env.readRemote.mockClear(); env.readConflicts.mockClear();
    syncStatusChanges({ lastSyncAt: at(20), conflicts: 0 }, { lastSyncAt: at(20), conflicts: 0, ...change });
    await vi.waitFor(() => expect(env.readConflicts).toHaveBeenCalledOnce());
    expect(env.readRemote).toHaveBeenCalledOnce();
  }
});
it("#8 自动同步刚开始时不读，还在读本机状态时不抢先填上远端状态", async () => {
  syncStatusChanges({ running: false }, { running: true });
  await Promise.resolve();
  expect(env.readRemote).not.toHaveBeenCalled();
  env.current = synced(25);
  syncStatusChanges({ running: true }, { running: false, lastSyncAt: at(25) }, { remote: undefined });
  await vi.waitFor(() => expect(env.setters[REMOTE]).toHaveBeenCalled());
  expect(applied(undefined).remote).toBeUndefined();
});
it("#8 读到之前状态又变了：旧的那次结果不再写回卡上", async () => {
  let finish!: (value: unknown) => void;
  env.readRemote.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  const cleanups = syncStatusChanges({ running: true }, { running: false, lastSyncAt: at(25) });
  expect(cleanups).toHaveLength(1);
  for (const cleanup of cleanups) cleanup();
  finish(synced(25));
  await new Promise((done) => setTimeout(done, 0));
  expect(env.setters[REMOTE]).not.toHaveBeenCalled();
  expect(env.setters[CONFLICTS]).not.toHaveBeenCalled();
});
