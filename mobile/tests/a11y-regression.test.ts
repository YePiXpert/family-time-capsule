import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/ai/AiSettingsSection", () => ({ AiSettingsSection: () => null }));
vi.mock("../src/components/GlassSheet", () => ({ GlassSheetProvider: ({ children }: { children: unknown }) => children, useConfirmSheet: () => vi.fn(async () => true), useAlertSheet: () => vi.fn(async () => {}), confirmSheet: vi.fn(async () => true), alertSheet: vi.fn(async () => {}) }));
vi.mock("../src/components/GlassCard", () => ({ GlassCard: "GlassCard" }));
vi.mock("../src/components/CollapsingHero", () => ({ useCollapsingHeroScroll: () => ({ scrollY: { interpolate: () => 0 }, onScroll: () => {} }), CollapsingHero: "CollapsingHero", CollapsingHeroBar: "CollapsingHeroBar" }));

/**
 * NAV-9 可访问性回归（GLM-C）：
 * - 系统大字号：共享文字样式不再固定 lineHeight，行高随字体缩放不裁剪；
 * - 高频触控目标 ≥48；
 * - 核心首页所有可点按元素都有 accessibilityRole（读屏可用），不只靠文字或图标。
 */

const mocks = vi.hoisted(() => ({
  navigation: { navigate: vi.fn() },
  app: {
    credentials: null,
    family: { id: "family-a", name: "我们一家", timezone: "Asia/Shanghai" },
    viewer: { id: "user-a", role: "admin" },
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
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect", Circle: "Circle" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => mocks.navigation }));
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({ ...mocks.app, hapticsEnabled: true, setHapticsEnabled: vi.fn() }),
}));

const { sharedStyles } = await import("../src/theme");

const { SettingsHubScreen } = await import("../src/screens/SettingsHubScreen");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
});

const TEXT_STYLE_NAMES = ["eyebrow", "title", "intro", "cardTitle", "body", "label", "primaryText", "secondaryText", "noticeText", "warningText", "error", "emptyTitle", "emptyText"] as const;

it("共享文字样式不固定行高：系统字体放大时行高随之缩放，不互相覆盖", () => {
  for (const name of TEXT_STYLE_NAMES) {
    const style = (sharedStyles as Record<string, unknown>)[name] as Record<string, unknown> | undefined;
    if (!style) continue;
    expect(style.lineHeight, `${name} 不应固定 lineHeight`).toBeUndefined();
  }
});

it("高频交互触控目标至少 48", () => {
  expect((sharedStyles.input as Record<string, unknown>).minHeight).toBeGreaterThanOrEqual(48);
  expect((sharedStyles.primaryButton as Record<string, unknown>).minHeight).toBeGreaterThanOrEqual(48);
  expect((sharedStyles.secondaryButton as Record<string, unknown>).minHeight).toBeGreaterThanOrEqual(48);
});

it("设置所有可点按元素都声明 accessibilityRole（读屏不只剩裸文本）", async () => {
  await act(async () => { tree = create(createElement(SettingsHubScreen)); });
  const morePressables = tree!.root.findAll((node) => String(node.type) === "Pressable");
  expect(morePressables.length).toBe(4);
  for (const node of morePressables) {
    expect(typeof node.props.accessibilityRole === "string").toBe(true);
  }
});
