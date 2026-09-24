import { beforeEach, expect, it, vi } from "vitest";
import { FamilyCard } from "../src/sync/FamilyCard";

const env = vi.hoisted(() => ({
  running: false,
  isRunning: vi.fn(),
  slots: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
  alerts: [] as { title: string; message: string; buttons: { text: string; onPress?: () => void }[] }[],
  sync: vi.fn(), join: vi.fn(), mark: vi.fn(), key: new Uint8Array(32), records: {} as Record<string, unknown>,
  navigate: vi.fn(), forget: vi.fn(), clear: vi.fn(), me: vi.fn(), remove: vi.fn(), wipe: vi.fn(), wipeFamily: vi.fn(),
}));
vi.mock("react", () => ({
  useState: () => {
    const setter = vi.fn();
    env.setters.push(setter);
    return [env.slots.shift(), setter];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: vi.fn(),
  useRef: () => ({ current: null }),
}));
vi.mock("react-native", () => ({ View: "View", Alert: { alert: (title: string, message: string, buttons: never[]) => env.alerts.push({ title, message, buttons }) } }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: vi.fn() }));
vi.mock("../src/family/session", () => ({ getToken: vi.fn() }));
vi.mock("../src/local/backup", () => ({ BackupStopped: class extends Error {} }));
vi.mock("../src/local/context", () => ({ useLibrary: () => ({ settings: {}, records: env.records }), useStore: () => ({}), useSyncStatus: () => ({ running: env.running }) }));
vi.mock("../src/local/navigation", () => ({ useNav: () => ({ navigate: env.navigate }) }));
vi.mock("../src/local/ui", () => ({ Button: "Button", Card: "Card", ErrorText: "ErrorText", Text: "Text", dateLabel: String, messageOf: String, useStyles: () => ({}) }));
vi.mock("../src/sync/crypto", () => ({ keyIdOf: () => "K" }));
vi.mock("../src/sync/family", () => ({ runFamilySync: env.sync, startSharing: env.join }));
vi.mock("../src/sync/status", () => ({
  markSyncRunning: env.mark,
  isSyncRunning: env.isRunning,
  claimSync: () => (env.isRunning() ? false : (env.mark(true), true)),
}));
vi.mock("../src/sync/engine", () => ({ verifyRemoteBackup: vi.fn() }));
vi.mock("../src/sync/state", () => ({
  clearSyncFiles: env.clear, forgetKey: env.forget,
  loadKey: async () => env.key, readRemoteState: async () => null, readConflicts: async () => [],
  unreadNotice: (summary?: { unread?: number }) => (summary?.unread ? `有 ${summary.unread} 台手机的内容这次没读到` : ""),
}));
vi.mock("../src/sync/transport", () => ({
  SyncError: class extends Error {},
  createTransport: () => ({ me: env.me, deleteManifest: env.remove, wipe: env.wipe, wipeFamily: env.wipeFamily }),
}));

type Element = { type?: unknown; props?: { testID?: string; title?: string; disabled?: boolean; message?: string; children?: unknown; onPress?: () => void } };
function nodes(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const element = node as Element;
  return [element, ...nodes(element.props?.children)];
}
function find(node: unknown, id: string): Element | undefined {
  if (Array.isArray(node)) return node.map(n => find(n, id)).find(Boolean);
  if (!node || typeof node !== "object") return;
  const element = node as Element;
  return element.props?.testID === id ? element : find(element.props?.children, id);
}
function render(owner = false, joined = true, status: unknown = null, keyId: string | null = null, signedIn: boolean | null = true, lastError = "", conflicts = 0) {
  // useState 槽位：signedIn、remote、progress、message、error、isOwner、conflicts、localKeyId、status、statusError。
  env.slots = [signedIn, joined ? { enabled: true, keyId: "a".repeat(16), lastError } : null, "", "", "", owner, conflicts, keyId, status, ""];
  env.setters = [];
  return FamilyCard({ busy: false });
}
beforeEach(() => {
  vi.clearAllMocks(); env.alerts = []; env.records = {};
  env.running = false;
  env.isRunning.mockReturnValue(false);
  env.sync.mockResolvedValue({ lastSyncSummary: { pulled: 2, pushed: 1, conflicts: 0 } });
  env.join.mockResolvedValue({});
});
it("已加入的卡只管同步：没有退出、查看恢复码这些入口", () => {
  const tree = render(true);
  for (const id of ["remote-disable", "remote-code", "remote-join"]) expect(find(tree, id)).toBeUndefined();
  expect(find(tree, "remote-backup")).toBeDefined();
  expect(find(tree, "remote-verify")).toBeDefined();
});
it("只有管理者看到全家删除入口，确认后清远端与同步文件，家庭钥匙留着", async () => {
  expect(find(render(), "remote-wipe-family")).toBeUndefined();
  find(render(true), "remote-wipe-family")!.props!.onPress!();
  env.alerts[0]!.buttons.find((b) => b.text === "删掉全家的远端")!.onPress!();
  await vi.waitFor(() => expect(env.clear).toHaveBeenCalledOnce());
  expect(env.wipeFamily).toHaveBeenCalledOnce();
  expect(env.forget).not.toHaveBeenCalled();
  expect(env.wipe).not.toHaveBeenCalled();
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
  const setMessage = env.setters[3]!;
  await vi.waitFor(() => expect(setMessage).toHaveBeenLastCalledWith(expect.stringContaining("1 段两台手机都改过")));
  expect(setMessage.mock.calls.at(-1)![0]).not.toContain("最新");
});
it("有手机没读成时同步结果照实说出来", async () => {
  env.sync.mockResolvedValueOnce({ lastSyncSummary: { pulled: 1, pushed: 0, conflicts: 0, unread: 1 } });
  find(render(), "remote-backup")!.props!.onPress!();
  const setMessage = env.setters[3]!;
  await vi.waitFor(() => expect(setMessage).toHaveBeenLastCalledWith(expect.stringContaining("有 1 台手机的内容这次没读到")));
  expect(setMessage.mock.calls.at(-1)![0]).toContain("并入 1 处改动");
});
it("令牌未读完时只有标题与正在读取，没有远端动作按钮", () => {
  const tree = render(false, false, null, null, null);
  const elements = nodes(tree);
  expect(elements.filter((el) => el.type === "Button" && el.props?.testID?.startsWith("remote-"))).toEqual([]);
  expect(elements.filter((el) => el.type === "Button")).toEqual([]);
  expect(elements.filter((el) => el.type === "Text").map((el) => el.props?.children)).toEqual(["家人一起写", "正在读取…"]);
});
it("未开始时按本机钥匙和远端状态显示唯一入口", () => {
  const noKey = render(false, false, { manifests: 2, keyId: "x" });
  expect(find(noKey, "remote-family")).toBeDefined();
  find(noKey, "remote-family")!.props!.onPress!();
  expect(env.navigate).toHaveBeenCalledWith("Family");
  const mismatch = render(false, false, { manifests: 2, keyId: "x" }, "K");
  expect(nodes(mismatch).filter((el) => el.type === "Button" && el.props?.testID?.startsWith("remote-"))).toEqual([]);
  expect(nodes(mismatch).find((el) => el.type === "ErrorText" && el.props?.message)!.props!.message).toContain("对不上");
  const start = render(false, false, { manifests: 0, keyId: null }, "K");
  expect(find(start, "remote-enable")!.props!.title).toBe("开始一起写");
  expect(find(start, "remote-resume")).toBeUndefined();
  const resume = render(false, false, { manifests: 2, keyId: "K" }, "K");
  expect(find(resume, "remote-resume")!.props!.title).toBe("加入一起写");
  expect(find(resume, "remote-enable")).toBeUndefined();
});
it("没加入家庭时只指去「家庭与设备」", () => {
  const tree = render(false, false, null, null, false);
  expect(nodes(tree).filter((el) => el.type === "Button").map((el) => el.props?.testID)).toEqual(["remote-family"]);
});
it("加入一起写用本机钥匙调用 startSharing（先留本机备份再并入）", async () => {
  find(render(false, false, { manifests: 2, keyId: "K" }, "K"), "remote-resume")!.props!.onPress!();
  await vi.waitFor(() => expect(env.mark).toHaveBeenLastCalledWith(false));
  expect(env.join).toHaveBeenCalledWith({}, env.key, { transport: expect.any(Object), onProgress: expect.any(Function), signal: expect.any(AbortSignal) });
  expect(env.mark.mock.calls).toEqual([[true], [false]]);
  expect(env.alerts).toEqual([]);
});
it("本机已有记录、家里也已有人在写：先确认会共享几段，再开始", async () => {
  env.records = { a: {}, b: {}, c: {} };
  find(render(false, false, { manifests: 2, keyId: "K" }, "K"), "remote-resume")!.props!.onPress!();
  expect(env.join).not.toHaveBeenCalled();
  expect(env.alerts[0]!.message).toContain("已有的 3 段时光会和家人共享");
  expect(env.alerts[0]!.message).toContain("本机留一份备份");
  env.alerts[0]!.buttons.find((b) => b.text === "开始")!.onPress!();
  await vi.waitFor(() => expect(env.join).toHaveBeenCalledOnce());
});
it("同步失败也会清掉运行标志", async () => {
  env.sync.mockRejectedValueOnce(new Error("离线"));
  find(render(), "remote-backup")!.props!.onPress!();
  await vi.waitFor(() => expect(env.mark).toHaveBeenLastCalledWith(false));
  expect(env.mark.mock.calls).toEqual([[true], [false]]);
});

it("自动同步时家人卡说明进度、禁用所有动作并隐藏旧错误，没有停止入口", () => {
  env.running = true;
  const tree = render(true, true, null, null, true, "上次失败", 1);
  expect(find(tree, "remote-backup")!.props).toMatchObject({ title: "正在同步…", disabled: true });
  expect(nodes(tree).filter((el) => el.type === "Button").every((el) => el.props?.disabled)).toBe(true);
  expect(nodes(tree).filter((el) => el.type === "ErrorText").map((el) => el.props?.message)).toEqual([""]);
  expect(find(tree, "remote-stop")).toBeUndefined();
});
it("未自动同步时保留现在同步标题和旧错误", () => {
  const tree = render(false, true, null, null, true, "上次失败");
  expect(find(tree, "remote-backup")!.props).toMatchObject({ title: "现在同步", disabled: false });
  expect(nodes(tree).find((el) => el.type === "ErrorText")!.props?.message).toBe("上次失败");
});
it("自动同步时未开始的入口也禁用", () => {
  env.running = true;
  expect(find(render(false, false, { manifests: 2, keyId: "x" }), "remote-family")!.props?.disabled).toBe(true);
  expect(find(render(false, false, { manifests: 0, keyId: null }, "K"), "remote-enable")!.props?.disabled).toBe(true);
  expect(find(render(false, false, { manifests: 2, keyId: "K" }, "K"), "remote-resume")!.props?.disabled).toBe(true);
});
it("上下文尚未刷新时同步守卫也会说明原因而不启动手动同步", () => {
  const tree = render();
  env.isRunning.mockReturnValue(true);
  find(tree, "remote-backup")!.props!.onPress!();
  expect(env.sync).not.toHaveBeenCalled();
  expect(env.mark).not.toHaveBeenCalled();
  expect(env.setters[3]).toHaveBeenCalledWith("正在同步，等它完成再试。");
});
