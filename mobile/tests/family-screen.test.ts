import { beforeEach, expect, it, vi } from "vitest";
import type { Props } from "../src/local/navigation";
import type { Overview } from "../src/family/api";
import { FamilyScreen, deviceLine, isLastAdminDevice } from "../src/family/FamilyScreen";
import { checkPositions, firstWrong } from "../src/family/Words";
import { qrModules } from "../src/family/Qr";

const env = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  records: {} as Record<string, unknown>,
  alerts: [] as { title: string; buttons: { text: string; onPress?: () => void }[] }[],
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
  share: vi.fn(), newest: vi.fn(), leave: vi.fn(), mark: vi.fn(), busy: vi.fn(),
  forgetToken: vi.fn(), forgetDeviceKey: vi.fn(), token: vi.fn(),
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = env.cursor++;
    if (index >= env.slots.length) env.slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [env.slots[index], (next: unknown) => { env.slots[index] = next; }];
  },
  useRef: () => ({ current: null }),
  useEffect: vi.fn(),
  useCallback: (fn: unknown) => fn,
}));
vi.mock("react-native", () => ({
  View: "View",
  StyleSheet: { hairlineWidth: 1 },
  Platform: { OS: "ios" },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  Alert: { alert: (title: string, _message: string, buttons: never[]) => env.alerts.push({ title, buttons }) },
}));
vi.mock("expo-crypto", async () => {
  const { randomBytes } = await import("node:crypto");
  return { getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)), randomUUID: () => "u" };
});
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-camera", () => ({}));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect" }));
vi.mock("../src/local/context", () => ({ useStore: () => ({}), useLibrary: () => ({ records: env.records }) }));
vi.mock("../src/local/ui", () => ({
  Button: "Button", Card: "Card", DangerCard: "DangerCard", ErrorText: "ErrorText", Field: "Field", FieldRow: "FieldRow",
  Page: "Page", SettingsGroup: "SettingsGroup", SettingsRow: "SettingsRow", Text: "Text",
  messageOf: (e: Error) => e.message, useStyles: () => ({}), useTheme: () => ({ colors: {} }),
}));
vi.mock("../src/sync/family", () => ({ startSharing: env.share, readNewestManifest: env.newest, leaveFamily: env.leave }));
vi.mock("../src/sync/state", () => ({ unreadNotice: () => "" }));
vi.mock("../src/sync/status", () => ({ claimSync: () => (env.mark(true), true), isLocalBusy: env.busy, markSyncRunning: env.mark }));
vi.mock("../src/sync/transport", () => ({ SyncError: class extends Error {}, createTransport: () => ({}) }));
vi.mock("../src/family/api", async () => {
  const actual = await vi.importActual<typeof import("../src/family/api")>("../src/family/api");
  return { ...actual, createFamilyApi: () => env.api };
});
vi.mock("../src/family/session", () => ({ getToken: env.token, forgetToken: env.forgetToken }));
vi.mock("../src/family/keys", () => ({ forgetDeviceKey: env.forgetDeviceKey }));
vi.mock("../src/family/pairing", () => ({}));

type Element = { type?: unknown; props?: { testID?: string; children?: unknown; title?: string; message?: string; onPress?: () => void } };
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
// useState 槽位：api、step、busy、error、message、progress、synced……
const STEP = 1, ERROR = 3, MESSAGE = 4, SYNCED = 6;
const navigation = { addListener: vi.fn(() => () => {}), dispatch: vi.fn() };
function render(step?: unknown) {
  env.cursor = 0;
  if (step !== undefined) {
    FamilyScreen({ navigation } as unknown as Props<"Family">);
    env.slots[STEP] = step;
    env.cursor = 0;
  }
  return FamilyScreen({ navigation } as unknown as Props<"Family">);
}
const joined = {
  key: new Uint8Array(16),
  familyId: "f",
  keyId: "k",
  member: { id: "m", name: "萌萌", role: "admin" as const, deviceId: "d2" },
};
const family = {
  familyId: "f",
  keyId: "0123456789abcdef",
  recoveryVersion: 1,
  me: { memberId: "m1", deviceId: "d1", name: "爸爸", role: "admin" as const },
  members: [{ id: "m1", name: "爸爸", role: "admin" as const, enabled: true }],
};
const overview = (devices: Partial<Overview["devices"][number]>[]): Overview => ({
  members: [
    { id: "m1", name: "爸爸", role: "admin", enabled: 1, photo_limit: 100, write_limit: 20 },
    { id: "m2", name: "外婆", role: "member", enabled: 1, photo_limit: 100, write_limit: 20 },
  ],
  devices: devices.map((d, i) => ({
    id: `d${i + 1}`, member_id: "m1", name: `手机${i + 1}`, revoked: 0, created_at: 0,
    last_used_at: null, approved_by: null, pending: 0, ...d,
  })),
});
beforeEach(() => {
  vi.clearAllMocks();
  env.slots = []; env.cursor = 0; env.records = {}; env.alerts = [];
  env.api = { leave: vi.fn(), family: vi.fn(), overview: vi.fn() };
  env.busy.mockReturnValue(false);
});

it("没加入时给三个入口，不出现任何登录与密码", () => {
  const tree = render({ kind: "out", note: "这台手机已被停用" });
  for (const id of ["family-join", "family-start", "family-recover"]) expect(find(tree, id)).toBeDefined();
  expect(text(tree)).toContain("这台手机已被停用");
  expect(text(tree)).not.toMatch(/登录|用户名/);
  expect(nodes(tree).filter((el) => el.type === "Field" || el.type === "FieldRow")).toEqual([]);
});
it("已获准与第一次同步分开：先说是谁，按了才同步，本机已有几段先讲清楚", async () => {
  env.records = { a: {}, b: {}, c: {} };
  let tree = render({ kind: "approved", joined, recovered: false, readable: null });
  expect(text(tree)).toContain("已获准");
  expect(text(tree)).toContain("你是「萌萌」（管理者）");
  expect(text(tree)).toContain("已有的 3 段时光");
  expect(text(tree)).toContain("先在本机留一份备份");
  expect(env.share).not.toHaveBeenCalled();
  env.share.mockResolvedValueOnce({ lastSyncSummary: { devices: 2 } });
  find(tree, "family-first-sync")!.props!.onPress!();
  await vi.waitFor(() => expect(env.slots[SYNCED]).toBe(true));
  expect(env.share).toHaveBeenCalledWith({}, joined.key, { transport: {}, onProgress: expect.any(Function), signal: expect.any(AbortSignal) });
  expect(env.slots[MESSAGE]).toContain("第一次同步完成，2 台手机在一起写。");
  expect(env.mark.mock.calls).toEqual([[true], [false]]);
  tree = render();
  expect(find(tree, "family-first-sync")).toBeUndefined();
  expect(find(tree, "family-approved-done")).toBeDefined();
});
it("本机正在备份或恢复时不开始第一次同步", async () => {
  env.busy.mockReturnValue(true);
  find(render({ kind: "approved", joined, recovered: false, readable: null }), "family-first-sync")!.props!.onPress!();
  await vi.waitFor(() => expect(env.slots[ERROR]).toContain("本机正在备份或恢复"));
  expect(env.share).not.toHaveBeenCalled();
});
it("找回后没真解开远端的一份，就不给同步入口", async () => {
  const tree = render({ kind: "approved", joined, recovered: true, readable: null });
  expect(text(tree)).toContain("已找回");
  expect(find(tree, "family-first-sync")).toBeUndefined();
  env.newest.mockResolvedValueOnce({ deviceName: "爸爸的 iPhone", createdAt: "2026-09-20T10:00:00.000Z" });
  find(tree, "family-recover-verify")!.props!.onPress!();
  await vi.waitFor(() => expect((env.slots[STEP] as { readable: string }).readable).toContain("「爸爸的 iPhone」"));
  expect(find(render(), "family-first-sync")).toBeDefined();
});
it("最后一台管理者手机不能退出：先拦下，不忘钥匙、不撤令牌", async () => {
  const tree = render({ kind: "home", family, overview: overview([{}]) });
  find(tree, "family-leave")!.props!.onPress!();
  env.alerts[0]!.buttons.find((b) => b.text === "退出")!.onPress!();
  await vi.waitFor(() => expect(env.slots[ERROR]).toContain("最后一台管理者手机"));
  expect(env.leave).not.toHaveBeenCalled();
  expect(env.api.leave).not.toHaveBeenCalled();
  expect(env.forgetToken).not.toHaveBeenCalled();
});
it("退出：先撤下远端那一份，再作废令牌，最后忘掉令牌与设备密钥", async () => {
  const order: string[] = [];
  env.leave.mockImplementation(async () => { order.push("sync"); return { removedRemote: true }; });
  env.api.leave!.mockImplementation(async () => { order.push("server"); });
  env.forgetToken.mockImplementation(async () => { order.push("token"); });
  env.forgetDeviceKey.mockImplementation(async () => { order.push("device-key"); });
  env.token.mockResolvedValue(null);
  find(render({ kind: "home", family, overview: overview([{}, {}]) }), "family-leave")!.props!.onPress!();
  env.alerts[0]!.buttons.find((b) => b.text === "退出")!.onPress!();
  await vi.waitFor(() => expect((env.slots[STEP] as { kind: string }).kind).toBe("out"));
  expect(order).toEqual(["sync", "server", "token", "device-key"]);
  expect(env.mark.mock.calls).toEqual([[true], [false]]);
});
it("家人（非管理者）看不到添加、设备与换恢复码", () => {
  const tree = render({ kind: "home", family: { ...family, me: { ...family.me, role: "member" } }, overview: null });
  for (const id of ["family-add", "family-devices-open", "family-regenerate"]) expect(find(tree, id)).toBeUndefined();
  expect(find(tree, "family-leave")).toBeDefined();
});
it("最后一台管理者设备的判断与服务端一致：待确认、已停用、停用管理者名下的都不算", () => {
  expect(isLastAdminDevice(overview([{}]), "d1")).toBe(true);
  expect(isLastAdminDevice(overview([{}, {}]), "d1")).toBe(false);
  expect(isLastAdminDevice(overview([{}, { pending: 1 }]), "d1")).toBe(true);
  expect(isLastAdminDevice(overview([{}, { revoked: 1 }]), "d1")).toBe(true);
  expect(isLastAdminDevice(overview([{}, { member_id: "m2" }]), "d1")).toBe(true);
  expect(isLastAdminDevice(overview([{}]), "d9")).toBe(false);
  expect(deviceLine(overview([{ pending: 1 }]).devices[0]!)).toContain("等这台手机确认");
  expect(deviceLine(overview([{}]).devices[0]!)).toBe("还没用过");
  expect(deviceLine(overview([{ last_used_at: Date.UTC(2026, 8, 20) }]).devices[0]!)).toMatch(/^最后使用 /);
});
it("恢复码核对：随机抽 3 个不同位置，大小写与空格不算错", () => {
  for (let i = 0; i < 50; i++) {
    const at = checkPositions();
    expect(new Set(at).size).toBe(3);
    expect(at.every((n) => n >= 0 && n < 12)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  }
  const words = "abandon ability able about above absent absorb abstract absurd abuse access accident".split(" ");
  expect(firstWrong(words, [0, 5, 11], [" Abandon", "absent ", "ACCIDENT"])).toBeNull();
  expect(firstWrong(words, [0, 5, 11], ["abandon", "absurd", "accident"])).toBe(5);
});
it("二维码矩阵：同一段文字稳定、放得下配对码", () => {
  const text = `anan-pair:1:00000000-0000-4000-8000-000000000001:${"A".repeat(43)}:${"B".repeat(43)}`;
  const a = qrModules(text), b = qrModules(text);
  expect(a).toEqual(b);
  expect(a.length).toBe(a[0]!.length);
  expect(a.length).toBeGreaterThanOrEqual(21);
  // 三个定位角：左上 7×7 的外框全黑。
  expect(a[0]!.slice(0, 7).every(Boolean)).toBe(true);
  expect(a[6]!.slice(0, 7).every(Boolean)).toBe(true);
});
