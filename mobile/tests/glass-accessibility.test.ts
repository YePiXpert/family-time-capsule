import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ handlers: new Map<string, (value: boolean) => void>(), finish: null as null | ((value: boolean) => void), removed: vi.fn() }));
vi.mock("react-native", () => ({
  View: "View", Platform: { OS: "android", Version: 33 },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => false,
    isReduceTransparencyEnabled: () => new Promise<boolean>(resolve => { state.finish = resolve; }),
    addEventListener: (event: string, handler: (value: boolean) => void) => { state.handlers.set(event, handler); return { remove: state.removed }; },
  },
}));
vi.mock("expo-blur", () => ({ BlurView: "BlurView" }));
const { GlassSurface } = await import("../src/components/GlassSurface");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
