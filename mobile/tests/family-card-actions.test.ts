import { beforeEach, expect, it, vi } from "vitest";
import { FamilyCard } from "../src/sync/FamilyCard";

const env = vi.hoisted(() => ({
  running: false,
  isRunning: vi.fn(),
  slots: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
  alerts: [] as { title: string; message: string; buttons: { text: string; onPress?: () => void }[] }[],
  sync: vi.fn(), join: vi.fn(), leave: vi.fn(), mark: vi.fn(), key: new Uint8Array(32),
  forget: vi.fn(), clear: vi.fn(), me: vi.fn(), remove: vi.fn(), wipe: vi.fn(), wipeFamily: vi.fn(),
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
vi.mock("expo-local-authentication", () => ({}));
vi.mock("../src/ai/session", () => ({ getToken: vi.fn() }));
vi.mock("../src/local/backup", () => ({ BackupStopped: class extends Error {} }));
vi.mock("../src/local/context", () => ({ useLibrary: () => ({ settings: {} }), useStore: () => ({}), useSyncStatus: () => ({ running: env.running }) }));
vi.mock("../src/local/navigation", () => ({ useNav: () => ({}) }));
vi.mock("../src/local/ui", () => ({ Button: "Button", Card: "Card", ErrorText: "ErrorText", Text: "Text", dateLabel: String, messageOf: String, useStyles: () => ({}) }));
vi.mock("../src/sync/crypto", () => ({ keyIdOf: () => "K", newMasterKey: vi.fn() }));
vi.mock("../src/sync/family", () => ({ runFamilySync: env.sync, joinFamily: env.join, leaveFamily: env.leave }));
vi.mock("../src/sync/status", () => ({ markSyncRunning: env.mark, isSyncRunning: env.isRunning }));
vi.mock("../src/sync/engine", () => ({ verifyRemoteBackup: vi.fn() }));
vi.mock("../src/sync/state", () => ({
  clearRemoteState: env.clear, clearSyncFiles: env.clear, forgetKey: env.forget,
  freshRemoteState: vi.fn(), loadKey: async () => env.key, readRemoteState: async () => null, readConflicts: async () => [],
  storeKey: vi.fn(), writeRemoteState: vi.fn(),
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
  vi.clearAllMocks(); env.alerts = [];
  env.running = false;
  env.isRunning.mockReturnValue(false);
  env.leave.mockResolvedValue({ removedRemote: true });
  env.sync.mockResolvedValue({ lastSyncSummary: { pulled: 2, pushed: 1, conflicts: 0 } });
  env.join.mockResolvedValue({});
});
it("退出确认只调用 leaveFamily 并传入传输与停止信号", async () => {
  find(render(), "remote-disable")!.props!.onPress!();
  expect(env.alerts[0]!.title).toContain("退出");
  expect(env.alerts[0]!.buttons.map((b) => b.text)).toEqual(["取消", "退出"]);
  env.alerts[0]!.buttons.find((b) => b.text === "退出")!.onPress!();
  await vi.waitFor(() => expect(env.leave).toHaveBeenCalledOnce());
  expect(env.leave).toHaveBeenCalledWith({ transport: expect.any(Object), signal: expect.any(AbortSignal) });
  expect(env.wipe).not.toHaveBeenCalled();
  expect(env.wipeFamily).not.toHaveBeenCalled();
});
it("只有主人看到全家删除入口，确认后清远端、钥匙与同步文件", async () => {
  expect(find(render(), "remote-wipe-family")).toBeUndefined();
  find(render(true), "remote-wipe-family")!.props!.onPress!();
  env.alerts[0]!.buttons.find((b) => b.text === "删掉全家的远端")!.onPress!();
  await vi.waitFor(() => expect(env.clear).toHaveBeenCalledOnce());
  expect(env.wipeFamily).toHaveBeenCalledOnce();
  expect(env.forget).toHaveBeenCalledOnce();
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
it("令牌未读完时只有标题与正在读取，没有远端动作按钮", () => {
  const tree = render(false, false, null, null, null);
  const elements = nodes(tree);
  expect(elements.filter((el) => el.type === "Button" && el.props?.testID?.startsWith("remote-"))).toEqual([]);
  expect(elements.filter((el) => el.type === "Button")).toEqual([]);
  expect(elements.filter((el) => el.type === "Text").map((el) => el.props?.children)).toEqual(["家人一起写", "正在读取…"]);
});
it("未加入时按远端状态和本机钥匙显示唯一入口", () => {
  const join = render(false, false, { manifests: 2, keyId: "x" });
  expect(find(join, "remote-join")).toBeDefined();
  expect(find(join, "remote-enable")).toBeUndefined();
  const start = render(false, false, { manifests: 0, keyId: null });
  expect(find(start, "remote-enable")).toBeDefined();
  expect(find(start, "remote-join")).toBeUndefined();
  const resume = render(false, false, { manifests: 2, keyId: "K" }, "K");
  expect(find(resume, "remote-resume")).toBeDefined();
  expect(find(resume, "remote-join")).toBeUndefined();
});
it("继续一起写加载本机钥匙并调用 joinFamily", async () => {
  find(render(false, false, { manifests: 2, keyId: "K" }, "K"), "remote-resume")!.props!.onPress!();
  await vi.waitFor(() => expect(env.mark).toHaveBeenLastCalledWith(false));
  expect(env.join).toHaveBeenCalledWith({}, env.key, { transport: expect.any(Object), onProgress: expect.any(Function), signal: expect.any(AbortSignal) });
  expect(env.mark.mock.calls).toEqual([[true], [false]]);
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
it("自动同步时未加入的加入、开始与继续入口也禁用", () => {
  env.running = true;
  expect(find(render(false, false, { manifests: 2, keyId: "x" }), "remote-join")!.props?.disabled).toBe(true);
  expect(find(render(false, false, { manifests: 0, keyId: null }), "remote-enable")!.props?.disabled).toBe(true);
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
