import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ handlers: new Map<string, (value: boolean) => void>(), finish: null as null | ((value: boolean) => void), removed: vi.fn(), platform: { OS: "android", Version: 33 }, apiAvailable: true, glassAvailable: true }));
vi.mock("react-native", () => ({
  View: "View", Platform: state.platform,
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => false,
    isReduceTransparencyEnabled: () => new Promise<boolean>(resolve => { state.finish = resolve; }),
    addEventListener: (event: string, handler: (value: boolean) => void) => { state.handlers.set(event, handler); return { remove: state.removed }; },
  },
}));
vi.mock("expo-blur", () => ({ BlurView: "BlurView" }));
vi.mock("expo-glass-effect", () => ({ GlassView: "GlassView", isGlassEffectAPIAvailable: () => state.apiAvailable, isLiquidGlassAvailable: () => state.glassAvailable }));
vi.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
const { GlassSurface } = await import("../src/components/GlassSurface");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  state.platform.OS = "android"; state.platform.Version = 33;
  state.apiAvailable = true; state.glassAvailable = true;
  state.handlers.clear(); state.removed.mockClear();
});
it("uses an opaque fallback until preferences load and immediately disables blur when transparency is reduced", async () => {
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(createElement(GlassSurface, { target: { current: null } })); });
  expect(tree!.root.findAllByType("BlurView" as never)).toHaveLength(0);
  await act(async () => { state.finish!(false); });
  expect(tree!.root.findAllByType("BlurView" as never)).toHaveLength(1);
  await act(async () => { state.handlers.get("reduceTransparencyChanged")!(true); });
  expect(tree!.root.findAllByType("BlurView" as never)).toHaveLength(0);
  await act(() => tree!.unmount());
  expect(state.removed).toHaveBeenCalledTimes(2);
});
it("does not overwrite a newer accessibility event with a stale initial query", async () => {
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(createElement(GlassSurface, { target: { current: null } })); });
  await act(async () => { state.handlers.get("reduceTransparencyChanged")!(true); state.finish!(false); });
  expect(tree!.root.findAllByType("BlurView" as never)).toHaveLength(0);
  await act(() => tree!.unmount());
});

it("uses native Liquid Glass on supported iOS and removes it as soon as transparency is reduced", async () => {
  state.platform.OS = "ios"; state.platform.Version = 26;
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(createElement(GlassSurface)); });
  expect(tree!.root.findAllByType("GlassView" as never)).toHaveLength(0);
  await act(async () => { state.finish!(false); });
  expect(tree!.root.findAllByType("GlassView" as never)).toHaveLength(1);
  expect(tree!.root.findAllByType("BlurView" as never)).toHaveLength(0);
  await act(async () => { state.handlers.get("reduceTransparencyChanged")!(true); });
  expect(tree!.root.findAllByType("GlassView" as never)).toHaveLength(0);
  expect(tree!.root.findAllByType("LinearGradient" as never)).toHaveLength(0);
  await act(() => tree!.unmount());
});

it.each([[false, true], [true, false]])("falls back safely when iOS API availability is %s and compiled glass support is %s", async (api, glass) => {
  state.platform.OS = "ios"; state.apiAvailable = api; state.glassAvailable = glass;
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(createElement(GlassSurface)); });
  await act(async () => { state.finish!(false); });
  expect(tree!.root.findAllByType("GlassView" as never)).toHaveLength(0);
  expect(tree!.root.findAllByType("BlurView" as never)).toHaveLength(1);
  await act(() => tree!.unmount());
});

it.each([30, 33])("keeps Android %s opaque when no screen blur target is supplied", async version => {
  state.platform.Version = version;
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(createElement(GlassSurface)); });
  await act(async () => { state.finish!(false); });
  expect(tree!.root.findAllByType("BlurView" as never)).toHaveLength(0);
  expect(tree!.root.findAllByType("GlassView" as never)).toHaveLength(0);
  await act(() => tree!.unmount());
});
