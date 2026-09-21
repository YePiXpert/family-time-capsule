import { beforeEach, expect, it, vi } from "vitest";
import { RemoteBackupCard } from "../src/sync/RemoteBackupCard";

const env = vi.hoisted(() => ({
  slots: [] as unknown[],
  alerts: [] as { title: string; message: string; buttons: { text: string; onPress?: () => void }[] }[],
  manifests: new Set<string>(),
  forget: vi.fn(), clear: vi.fn(), me: vi.fn(), remove: vi.fn(), wipe: vi.fn(), wipeFamily: vi.fn(),
}));
vi.mock("react", () => ({
  useState: () => [env.slots.shift(), vi.fn()],
  useCallback: (fn: unknown) => fn,
  useEffect: vi.fn(),
  useRef: () => ({ current: null }),
}));
vi.mock("react-native", () => ({ View: "View", Alert: { alert: (title: string, message: string, buttons: never[]) => env.alerts.push({ title, message, buttons }) } }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: vi.fn() }));
vi.mock("expo-local-authentication", () => ({}));
vi.mock("../src/ai/session", () => ({ getToken: vi.fn() }));
vi.mock("../src/local/backup", () => ({ BackupStopped: class extends Error {} }));
vi.mock("../src/local/context", () => ({ useLibrary: () => ({ settings: {} }), useStore: () => ({}) }));
vi.mock("../src/local/navigation", () => ({ useNav: () => ({}) }));
vi.mock("../src/local/ui", () => ({ Button: "Button", Card: "Card", ErrorText: "ErrorText", Text: "Text", dateLabel: String, messageOf: String, useStyles: () => ({}) }));
vi.mock("../src/sync/crypto", () => ({ keyIdOf: vi.fn(), newMasterKey: vi.fn() }));
vi.mock("../src/sync/engine", () => ({ runRemoteBackup: vi.fn(), verifyRemoteBackup: vi.fn() }));
vi.mock("../src/sync/state", () => ({
  clearRemoteState: env.clear, clearSyncFiles: env.clear, forgetKey: env.forget,
  freshRemoteState: vi.fn(), loadKey: vi.fn(), readRemoteState: async () => null,
  storeKey: vi.fn(), writeRemoteState: vi.fn(),
}));
vi.mock("../src/sync/transport", () => ({
  SyncError: class extends Error {},
  createTransport: () => ({ me: env.me, deleteManifest: env.remove, wipe: env.wipe, wipeFamily: env.wipeFamily }),
}));

type Element = { props?: { testID?: string; children?: unknown; onPress?: () => void } };
function find(node: unknown, id: string): Element | undefined {
  if (Array.isArray(node)) return node.map(n => find(n, id)).find(Boolean);
  if (!node || typeof node !== "object") return;
  const element = node as Element;
  return element.props?.testID === id ? element : find(element.props?.children, id);
}
function render(owner = false, deviceId?: string) {
  // 按组件的状态声明顺序提供已登录、已开启的本机状态。
  env.slots = [true, { enabled: true, keyId: "a".repeat(16), deviceId }, "", "", "", owner];
  return RemoteBackupCard({ busy: false });
}
beforeEach(() => {
  vi.clearAllMocks(); env.alerts = []; env.manifests = new Set(["A", "B"]);
  env.me.mockResolvedValue({ deviceId: "B" });
  env.remove.mockImplementation(async (id: string) => { env.manifests.delete(id); });
  env.wipe.mockImplementation(async () => { env.manifests.clear(); });
  env.wipeFamily.mockImplementation(async () => { env.manifests.clear(); });
});
it.each(["B", undefined])("A-16 设备 B 撤下本机，保留同成员设备 A（本机 ID %s）", async (id) => {
  find(render(false, id), "remote-disable")!.props!.onPress!();
  const action = env.alerts[0]!.buttons.find(b => b.text === "只撤下这台手机");
  expect(action).toBeDefined(); action!.onPress!();
  await vi.waitFor(() => expect(env.clear).toHaveBeenCalled());
  expect(env.manifests.has("A")).toBe(true);
  expect(env.manifests.has("B")).toBe(false);
  expect(env.remove).toHaveBeenCalledWith("B", expect.any(AbortSignal));
  expect(env.wipe).not.toHaveBeenCalled(); expect(env.forget).toHaveBeenCalledOnce();
});
it("A-16 只有主人看到清空全家入口，确认后走家庭删除", async () => {
  expect(find(render(), "remote-wipe-family")).toBeUndefined();
  find(render(true), "remote-wipe-family")!.props!.onPress!();
  expect(env.alerts[0]!.message).toContain("全家");
  env.alerts[0]!.buttons.find(b => b.text === "删掉全家的远端备份")!.onPress!();
  await vi.waitFor(() => expect(env.clear).toHaveBeenCalled());
  expect(env.wipeFamily).toHaveBeenCalledOnce(); expect(env.wipe).not.toHaveBeenCalled();
  expect(env.manifests.size).toBe(0);
});
it("A-16 撤下失败时保留恢复码和本机参与状态", async () => {
  env.remove.mockRejectedValue(new Error("暂时连不上"));
  find(render(false, "B"), "remote-disable")!.props!.onPress!();
  env.alerts[0]!.buttons.find(b => b.text === "只撤下这台手机")!.onPress!();
  await vi.waitFor(() => expect(env.remove).toHaveBeenCalled());
  expect(env.forget).not.toHaveBeenCalled(); expect(env.clear).not.toHaveBeenCalled();
  expect(env.manifests).toEqual(new Set(["A", "B"]));
});
