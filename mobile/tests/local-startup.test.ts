import { createRequire } from "node:module";
import { createElement, useEffect, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), sync: vi.fn(), clearFiles: vi.fn(), network: vi.fn(), renderFailure: false,
  credentials: null as { serverUrl: string; token: string; instanceId: string } | null, listProps: [] as Record<string, unknown>[] }));
vi.mock("react-native", async () => {
  const require = createRequire(import.meta.url);
  const native = require("./runtime/native-scroll.cjs") as {
    AnimatedEvent: new (...args: unknown[]) => { __getHandler(): (...args: unknown[]) => void };
    event: (mapping: unknown[], config: { useNativeDriver: boolean }) => unknown;
    checkListProps: (props: Record<string, unknown>) => void;
  };
  type ListProps = { data: unknown[]; onScroll?: unknown; ListHeaderComponent?: ReactNode; ListEmptyComponent?: ReactNode; renderItem: (item: { item: unknown; index: number }) => ReactNode };
  function FlatList(props: ListProps) {
    if (mocks.renderFailure) throw new Error("Synthetic native screen render failure");
    // This is RN's installed release-mode guard, not a duplicated assertion.
    native.checkListProps({ ...props, getItemCount: (data: unknown[]) => data.length });
    mocks.listProps.push(props);
    return createElement("FlatList", props,
      props.ListHeaderComponent,
      props.data.length ? props.data.map((item, index) => createElement("Cell", { key: index }, props.renderItem({ item, index }))) : props.ListEmptyComponent);
  }
  function AnimatedFlatList(props: ListProps) {
    return createElement(FlatList, { ...props, onScroll: props.onScroll instanceof native.AnimatedEvent ? props.onScroll.__getHandler() : props.onScroll });
  }
  class Value {
    value: number;
    constructor(value: number) { this.value = value; }
    interpolate() { return 0; }
    setValue(value: number) { this.value = value; }
  }
  return {
    ActivityIndicator: "ActivityIndicator", Image: "Image", Modal: "Modal", Pressable: "Pressable", FlatList,
    ScrollView: "ScrollView", RefreshControl: "RefreshControl", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
    Animated: { Value, event: native.event, View: "AnimatedView", FlatList: AnimatedFlatList, ScrollView: "AnimatedScrollView" },
    StyleSheet: { create: (v: unknown) => v, flatten: (v: unknown) => v, absoluteFill: {}, hairlineWidth: 1 },
    useColorScheme: () => "light", Platform: { OS: "ios", Version: 26 },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    AppState: { addEventListener: () => ({ remove() {} }) },
    AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isReduceMotionEnabled: async () => false, isReduceTransparencyEnabled: async () => true },
  };
});
vi.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({ children }: { children: ReactNode }) => children, useSafeAreaInsets: () => ({ top: 48, bottom: 34 }) }));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect", Circle: "Circle", Ellipse: "Ellipse", G: "G", Defs: "Defs", LinearGradient: "SvgGradient", Stop: "Stop" }));
vi.mock("react-native-gesture-handler/Swipeable", () => ({ default: "Swipeable" }));
vi.mock("react-native-gesture-handler", () => ({ GestureHandlerRootView: "GestureHandlerRootView" }));
vi.mock("expo-status-bar", () => ({ StatusBar: "StatusBar" }));
vi.mock("expo-blur", () => ({ BlurView: "BlurView" }));
vi.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
vi.mock("expo-glass-effect", () => ({ GlassView: "GlassView", isGlassEffectAPIAvailable: () => false, isLiquidGlassAvailable: () => false }));
vi.mock("expo-camera", () => ({ CameraView: "CameraView", useCameraPermissions: () => [null, vi.fn()] }));
vi.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: false }), addNetworkStateListener: () => ({ remove() {} }) }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mocks.navigate }), useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) }));
// Keep real startup, provider, SQLite, welcome screen, timeline and animation hook.
// The navigation host chooses the default screen without requiring a device bridge.
vi.mock("../src/navigation/AppNavigator", async () => ({ AppNavigator: (await import("../src/screens/TimelineScreen")).TimelineScreen }));
vi.mock("../src/screens/SyncConsentScreen", () => ({ SyncConsentScreen: "SyncConsentScreen" }));
vi.mock("../src/components/GlassSheet", () => ({ GlassSheetProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../src/notifications/cleanup", () => ({ clearRetiredReminders: async () => {} }));
vi.mock("../src/auth/credentials", () => ({ loadCredentials: async () => mocks.credentials, clearCredentials: vi.fn(), saveCredentials: vi.fn() }));
vi.mock("../src/storage/files", () => ({ clearLocalFiles: mocks.clearFiles, removeLocalFile: vi.fn() }));
vi.mock("../src/reading/native", () => ({ clearAllReadingDownloads: vi.fn(), revalidateReadingDownloads: vi.fn() }));
vi.mock("../src/native/intake", () => ({ drainNativeShareIntake: async () => ({ manifests: 0 }) }));
vi.mock("../modules/share-intake/src", () => ({ subscribeToPendingNativeShares: () => () => {} }));
vi.mock("../src/design/haptics", () => ({ haptics: { impact: vi.fn(), selection: vi.fn() }, setHapticsEnabled: vi.fn() }));
vi.mock("../src/memories/edit-sync", () => ({ syncMemoryEdits: async () => ({ saved: 0, needsAttention: 0 }) }));
vi.mock("../src/sync/sync", () => ({ syncArchive: mocks.sync }));
vi.mock("../src/api/client", () => ({ ApiError: class extends Error {}, fetchBootstrap: mocks.network, fetchMobileHome: mocks.network, fetchMe: mocks.network, signOut: mocks.network, submitOnboarding: mocks.network, requestMobileJson: mocks.network }));

const { default: App } = await import("../App");
const { clearLocalArchive, initializeLocalStore, getDatabase, getMeta, setMeta, enqueueTextCapture, getLocalCaptureDetail } = await import("../src/storage/database");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
beforeEach(async () => {
  await initializeLocalStore();
  await clearLocalArchive();
  vi.clearAllMocks();
  mocks.listProps.length = 0;
  mocks.renderFailure = false;
  mocks.credentials = null;
});

it("cold-starts offline into the current session's cached family timeline without authorizing an upload", async () => {
  const { memoryCacheScope } = await import("../src/memories/cache-scope");
  mocks.credentials = { serverUrl: "https://offline.test", instanceId: "instance", token: "synthetic-session" };
  const scope = memoryCacheScope(mocks.credentials, "user", "family")!;
  await setMeta("welcome_done", "1");
  await setMeta("family", JSON.stringify({ id: "family", name: "家庭", timezone: "UTC" }));
  await setMeta("viewer", JSON.stringify({ id: "user", role: "owner", canEditEvents: true, canReviewInbox: true }));
  const db = await getDatabase();
  await db.runAsync(`INSERT INTO timeline_event(id,scope,title,body_text,occurred_at,occurred_at_precision,updated_at,asset_count,participant_names_json)
    VALUES(?,?,?,?,?,'exact',?,0,'[]')`, "cached-family-event", scope, "离线读到的家庭照片", "本机缓存的说明", "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
  mocks.network.mockRejectedValueOnce(new Error("offline"));
  await launch();
  expect(textOf()).toContain("离线读到的家庭照片");
  expect(mocks.sync).not.toHaveBeenCalled();
});
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; });
async function launch() {
  await act(async () => { tree = create(createElement(App)); });
  // App opens storage, then the provider reads the saved first-run marker.
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}
function textOf() {
  return tree!.root.findAll(node => String(node.type) === "Text").flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
}
function press(label: string) {
  const text = tree!.root.findAll(node => String(node.type) === "Text" && node.children.includes(label))[0]!;
  let node = text.parent;
  while (node && typeof node.props.onPress !== "function") node = node.parent;
  if (!node) throw new Error(`Missing action: ${label}`);
  node.props.onPress();
}
it("chooses local recording and enters the real empty timeline with RN native scroll validation", async () => {
  await launch();
  await act(async () => { press("暂时只在本机记录"); });
  expect(await getMeta("welcome_done")).toBe("1");
  expect(mocks.listProps.at(-1)?.data).toEqual([]);
  expect(textOf()).toContain("第一篇成长记，从今天开始");
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.network).not.toHaveBeenCalled();
  expect(tree!.root.findAllByType("GestureHandlerRootView" as never)).toHaveLength(1);
});

it("offers retry after a damaged draft row without clearing the saved record", async () => {
  await setMeta("welcome_done", "1");
  await enqueueTextCapture("damaged-queue", { text: "原件必须保留" });
  const db = await getDatabase();
  const before = await getLocalCaptureDetail("damaged-queue");
  const { createLocalDraft } = await import("../src/drafts/store");
  const draft = await createLocalDraft("local", "damaged-draft", "mutation");
  await db.runAsync("UPDATE local_draft SET snapshot_json='invalid-json' WHERE id='damaged-draft'");
  await launch();
  expect(textOf()).toContain("本机资料暂时无法读取");
  expect(textOf()).toContain("重试");
  expect(await getLocalCaptureDetail("damaged-queue")).toEqual(before);
  // Restore the original draft bytes, then retry in the same process.
  await db.runAsync("UPDATE local_draft SET snapshot_json=? WHERE id='damaged-draft'", JSON.stringify(draft));
  await act(async () => { press("重试"); });
  expect(textOf()).toContain("原件必须保留");
  expect(textOf()).not.toContain("本机资料暂时无法读取");
  expect(mocks.clearFiles).not.toHaveBeenCalled();
  expect(mocks.network).not.toHaveBeenCalled();
});
it("cold-starts from an already saved local-mode marker and retains existing local text", async () => {
  await setMeta("welcome_done", "1");
  await enqueueTextCapture("local-startup-record", { text: "今天第一次挥手" });
  const before = await getLocalCaptureDetail("local-startup-record");
  await launch();
  expect(textOf()).toContain("挥手");
  await act(() => tree!.unmount()); tree = undefined;
  await launch();
  expect(textOf()).toContain("挥手");
  expect(await getLocalCaptureDetail("local-startup-record")).toEqual(before);
  expect(await getMeta("welcome_done")).toBe("1");
  expect(mocks.clearFiles).not.toHaveBeenCalled();
  expect(mocks.network).not.toHaveBeenCalled();
});

it("recovers a screen render failure without resetting the archive runtime or saved text", async () => {
  await setMeta("welcome_done", "1");
  await enqueueTextCapture("screen-retry", { text: "页面重试后还在" });
  mocks.renderFailure = true;
  await launch();
  expect(textOf()).toContain("页面暂时无法打开");
  mocks.renderFailure = false;
  await act(async () => { press("重试"); });
  expect(textOf()).toContain("页面重试后还在");
  expect(mocks.clearFiles).not.toHaveBeenCalled();
  expect(mocks.network).not.toHaveBeenCalled();
});
