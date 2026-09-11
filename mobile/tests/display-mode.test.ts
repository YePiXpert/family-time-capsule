import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/ai/AiSettingsSection", () => ({ AiSettingsSection: () => null }));
vi.mock("../src/components/GlassSheet", () => ({ GlassSheetProvider: ({ children }: { children: unknown }) => children, useConfirmSheet: () => vi.fn(async () => true), useAlertSheet: () => vi.fn(async () => {}), confirmSheet: vi.fn(async () => true), alertSheet: vi.fn(async () => {}) }));
vi.mock("../src/components/GlassCard", () => ({ GlassCard: "GlassCard" }));
vi.mock("../src/components/CollapsingHero", () => ({ useCollapsingHeroScroll: () => ({ scrollY: { interpolate: () => 0 }, onScroll: () => {} }), CollapsingHero: "CollapsingHero", CollapsingHeroBar: "CollapsingHeroBar" }));

/**
 * NAV-11 大字简洁显示（长辈阅读）：
 * 首页只保留四件事、标签更直白、「我的」隐藏高级入口、
 * 随时切回标准显示。权限与数据不因显示模式改变。
 */

const mocks = vi.hoisted(() => ({
  navigation: { navigate: vi.fn() },
  setDisplayMode: vi.fn(),
  app: {
    credentials: { serverUrl: "https://fictional.example.test", token: "t", instanceId: "instance-a" },
    family: { id: "family-a", name: "我们一家", timezone: "Asia/Shanghai" },
    viewer: { role: "admin" },
    people: [],
    events: [],
    outbox: [],
    home: null,
    syncing: false,
    runSync: vi.fn(),
    displayMode: "standard" as string | null,
  },
}));

vi.mock("react-native", () => ({
  Animated: { ScrollView: "ScrollView" },
  Image: "Image",
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  StyleSheet: { create: (v: unknown) => v },
  Switch: "Switch",
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect", Circle: "Circle" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => mocks.navigation }));
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({ ...mocks.app, setDisplayMode: mocks.setDisplayMode, hapticsEnabled: true, setHapticsEnabled: vi.fn() }),
}));

const { SettingsHubScreen } = await import("../src/screens/SettingsHubScreen");
const { DisplayModeCard } = await import("../src/components/DisplayModeCard");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let tree: ReactTestRenderer | undefined;
const json = () => JSON.stringify(tree!.toJSON());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.app.displayMode = "standard";
  mocks.app.home = null;
});
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
});

it.each(["standard", "simple"])("keeps the same four settings groups in %s display", async mode => {
  mocks.app.displayMode = mode;
  await act(async () => { tree = create(createElement(SettingsHubScreen)); });
  const groups = tree!.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityState?.expanded !== undefined);
  expect(groups.map(node => node.props.accessibilityLabel)).toEqual(["家人和账号", "存储与同步", "备份与恢复", "显示与辅助"]);
  await act(async () => groups[0]!.props.onPress());
  expect(json()).toContain("邀请家人加入");
  await act(async () => groups[3]!.props.onPress());
  expect(json()).not.toContain("邀请家人加入");
  expect(json()).toContain("大字显示");
});
it("changes the display preference without changing accounts", async () => {
  await act(async () => { tree = create(createElement(DisplayModeCard)); });
  await act(async () => tree!.root.findByProps({ testID: "display-simple" }).props.onPress());
  expect(mocks.setDisplayMode).toHaveBeenCalledWith("simple");
  expect(mocks.navigation.navigate).not.toHaveBeenCalled();
});
