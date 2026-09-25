import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

// 启动打不开本机资料时的「从完整备份恢复」：选择器复制进缓存的备份，
// 检查失败、取消、恢复成功或失败之后都要删掉（#11 的启动页那一半）。
const env = vi.hoisted(() => ({
  slots: [] as unknown[],
  setters: [] as ((next: unknown) => void)[],
  cursor: 0,
  alerts: [] as [string, string, { text: string; onPress?: () => void }[]][],
}));
const sameDeps = (a: unknown, b: unknown[] | undefined) =>
  Array.isArray(a) && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = env.cursor++;
    if (!(i in env.slots)) env.slots[i] = initial;
    env.setters[i] ??= (next: unknown) => {
      env.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(env.slots[i]) : next;
    };
    return [env.slots[i], env.setters[i]];
  },
  useCallback: (fn: unknown, deps?: unknown[]) => {
    const i = env.cursor++;
    const slot = env.slots[i] as { deps: unknown; value: unknown } | undefined;
    if (slot && sameDeps(slot.deps, deps)) return slot.value;
    env.slots[i] = { deps, value: fn };
    return fn;
  },
  // 依赖变了才重跑，和 React 一样。
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const i = env.cursor++;
    const slot = env.slots[i] as { deps: unknown } | undefined;
    if (slot && sameDeps(slot.deps, deps)) return;
    env.slots[i] = { deps };
    effect();
  },
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator", Alert: { alert: (...args: never) => env.alerts.push(args) },
  AppState: { addEventListener: () => ({ remove: () => {} }) }, BackHandler: {}, Keyboard: {},
  Platform: { OS: "android" }, ScrollView: "ScrollView", StyleSheet: { create: (s: unknown) => s },
  Text: "NativeText", View: "View", Pressable: "Pressable", useColorScheme: () => "light",
}));
vi.mock("@react-navigation/native", () => ({ NavigationContainer: "NavigationContainer", DefaultTheme: {}, DarkTheme: {} }));
vi.mock("@react-navigation/native-stack", () => ({ createNativeStackNavigator: () => ({ Navigator: "Navigator", Screen: "Screen" }) }));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: "SafeAreaProvider" }));
vi.mock("react-native-gesture-handler", () => ({ GestureHandlerRootView: "GestureHandlerRootView" }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(public uri: string) {}
  },
}));
vi.mock("expo-status-bar", () => ({ StatusBar: "StatusBar" }));
vi.mock("expo-local-authentication", () => ({}));
vi.mock("../modules/share-intake/src", () => ({ subscribeToPendingNativeShares: () => () => {} }));
vi.mock("../src/local/backup", () => ({
  discardPickedCopies: vi.fn(),
  inspectBackup: vi.fn(),
  recoverStartupBackup: vi.fn(),
  retainedBackups: () => [],
}));
vi.mock("../src/local/disk", () => ({ openLocalStore: vi.fn() }));
vi.mock("../src/local/files", () => ({ ensureDirectories: vi.fn(), verifyMedia: vi.fn() }));
vi.mock("../src/local/context", () => ({
  StoreContext: { Provider: "StoreProvider" }, SyncStatusContext: { Provider: "SyncProvider" },
  useLibrary: vi.fn(), useStore: vi.fn(),
}));
vi.mock("../src/local/ui", () => ({
  LocalTheme: "LocalTheme", Button: "Button", Card: "Card", ErrorText: "ErrorText", Page: "Page", Text: "Text",
  messageOf: (e: Error) => e.message,
  paletteOf: () => ({ paper: "#fff", ink: "#000", muted: "#666", accent: "#a00" }),
  useStyles: () => ({}), useTheme: () => ({ colors: {} }),
}));
vi.mock("../src/sync/Conflicts", () => ({ Conflicts: "Conflicts" }));
vi.mock("../src/sync/status", () => ({ useSyncStatusValue: vi.fn() }));
vi.mock("../src/sync/auto", () => ({ useAutoSync: vi.fn() }));
vi.mock("../src/family/FamilyScreen", () => ({ FamilyScreen: "FamilyScreen" }));
vi.mock("../src/local/Home", () => ({ Month: "Month" }));
vi.mock("../src/local/Year", () => ({ Year: "Year" }));
vi.mock("../src/local/SearchScreen", () => ({ SearchScreen: "SearchScreen" }));
vi.mock("../src/local/RecapScreen", () => ({ RecapScreen: "RecapScreen" }));
vi.mock("../src/local/Shelf", () => ({ Firsts: "Firsts", Shelf: "Shelf", TitlePage: "TitlePage" }));
vi.mock("../src/local/Albums", () => ({ AlbumScreen: "AlbumScreen", Picker: "Picker", AlbumDetails: "AlbumDetails" }));
vi.mock("../src/local/People", () => ({ People: "People" }));
vi.mock("../src/local/Settings", () => ({ Settings: "Settings", Profile: "Profile", Appearance: "Appearance" }));
vi.mock("../src/local/BackupPages", () => ({ Storage: "Storage", Backup: "Backup", Restore: "Restore", ReadableCopy: "ReadableCopy" }));
vi.mock("../src/local/Editor", () => ({ Editor: "Editor" }));
vi.mock("../src/local/Record", () => ({ RecordScreen: "RecordScreen" }));
vi.mock("../src/local/Media", () => ({ MediaScreen: "MediaScreen" }));
vi.mock("../src/local/LetterEditor", () => ({ LetterEditor: "LetterEditor" }));
vi.mock("../src/local/LetterScreen", () => ({ LetterScreen: "LetterScreen" }));
vi.mock("../src/local/Quotes", () => ({ Quotes: "Quotes" }));
vi.mock("../src/local/services", () => ({ receiveShares: vi.fn() }));
vi.mock("../src/local/health-file", () => ({ healthFile: vi.fn() }));
vi.mock("../src/local/lock", () => ({
  CoveredContext: { Provider: "CoveredProvider" }, LockedContext: { Provider: "LockedProvider" },
  unlockFailureMessage: vi.fn(),
}));

const App = (await import("../src/local/App")).default;
const DocumentPicker = await import("expo-document-picker");
const backup = await import("../src/local/backup");
const disk = await import("../src/local/disk");
const picker = vi.mocked(DocumentPicker.getDocumentAsync);
const discard = vi.mocked(backup.discardPickedCopies);
const inspect = vi.mocked(backup.inspectBackup);
const recoverStartup = vi.mocked(backup.recoverStartupBackup);

type Props = { children?: ReactNode; onPress?: () => void; disabled?: boolean; message?: string };
type Node = { type: unknown; props: Props };
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Props>(node)) return [];
  return [node as Node, ...nodes(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<Props>(node) ? text(node.props.children) : "";
}
function render() {
  env.cursor = 0;
  return App() as ReactNode;
}
const pressable = (label: string) =>
  nodes(render()).find((n) => n.type === "Pressable" && text(n.props.children).includes(label))?.props;
const alertButton = (label: string) => env.alerts.at(-1)![2].find((b) => b.text === label)!;
const PICKED = ["cache/DocumentPicker/A1/安安-备份-1.xmb", "cache/DocumentPicker/B2/安安-备份-2.xmb"];
const discarded = () => (discard.mock.calls[0]?.[0] as { uri: string }[] | undefined)?.map((f) => f.uri);

/** 开库失败，停在启动恢复页；点「从完整备份恢复」、选中两卷。 */
async function pickFromStartup() {
  render();
  await vi.waitFor(() => {
    render();
    expect(pressable("从完整备份恢复")).toBeDefined();
  });
  pressable("从完整备份恢复")!.onPress!();
  await vi.waitFor(() => expect(inspect).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  env.slots = []; env.setters = []; env.cursor = 0; env.alerts = [];
  vi.mocked(disk.openLocalStore).mockRejectedValue(new Error("本机资料读不出来"));
  picker.mockResolvedValue({ canceled: false, assets: PICKED.map((uri) => ({ uri })) } as never);
  inspect.mockResolvedValue({ records: { r: {} }, albums: {} } as never);
  recoverStartup.mockResolvedValue(undefined as never);
});

it("#11 启动页：备份检查不过，删掉选择器副本并显示错误", async () => {
  inspect.mockRejectedValueOnce(new Error("这不是完整备份"));
  await pickFromStartup();
  await vi.waitFor(() => expect(discarded()).toEqual(PICKED));
  expect(env.alerts).toEqual([]);
  await vi.waitFor(() => expect(text(render())).toContain("这不是完整备份"));
});
it("#11 启动页：确认框点取消，删掉选择器副本，不恢复", async () => {
  await pickFromStartup();
  await vi.waitFor(() => expect(env.alerts).toHaveLength(1));
  expect(discard).not.toHaveBeenCalled();
  alertButton("取消").onPress!();
  expect(discarded()).toEqual(PICKED);
  expect(recoverStartup).not.toHaveBeenCalled();
});
it("#11 启动页：恢复完成后删掉选择器副本，再重新开库", async () => {
  await pickFromStartup();
  await vi.waitFor(() => expect(env.alerts).toHaveLength(1));
  vi.mocked(disk.openLocalStore).mockResolvedValueOnce({} as never);
  alertButton("恢复备份").onPress!();
  await vi.waitFor(() => expect(discarded()).toEqual(PICKED));
  expect((recoverStartup.mock.calls[0]![0] as { uri: string }[]).map((f) => f.uri)).toEqual(PICKED);
  // 删在恢复之后：先恢复，再删副本。
  expect(recoverStartup.mock.invocationCallOrder[0]!).toBeLessThan(discard.mock.invocationCallOrder[0]!);
  expect(disk.openLocalStore).toHaveBeenCalledTimes(2);
});
it("#11 启动页：恢复失败也删掉选择器副本，错误照常显示", async () => {
  await pickFromStartup();
  await vi.waitFor(() => expect(env.alerts).toHaveLength(1));
  recoverStartup.mockRejectedValueOnce(new Error("空间不够"));
  alertButton("恢复备份").onPress!();
  await vi.waitFor(() => expect(discarded()).toEqual(PICKED));
  await vi.waitFor(() => expect(text(render())).toContain("空间不够"));
});
