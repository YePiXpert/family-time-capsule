import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  system: "light",
  app: { credentials: null as object | null, welcomeSeen: null as boolean | null, needsOnboarding: false, awaitingSyncConsent: false, displayMode: "standard", themeMode: "auto" },
}));
vi.mock("react-native", () => ({ View: "View", ActivityIndicator: "ActivityIndicator", StyleSheet: { create: (v: unknown) => v }, useColorScheme: () => state.system }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 48, bottom: 34 }) }));
vi.mock("expo-status-bar", () => ({ StatusBar: "StatusBar" }));
vi.mock("../src/state/AppContext", () => ({ useApp: () => state.app }));
vi.mock("../src/navigation/AppNavigator", () => ({ AppNavigator: "AppNavigator" }));
vi.mock("../src/screens/WelcomeFlow", () => ({ WelcomeFlow: "WelcomeFlow", OnboardingGate: "OnboardingGate" }));
vi.mock("../src/screens/SyncConsentScreen", () => ({ SyncConsentScreen: "SyncConsentScreen" }));
vi.mock("../src/components/GlassSheet", () => ({ GlassSheetProvider: ({ children }: { children: unknown }) => children }));
const { AppRoot } = await import("../src/AppRoot");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  state.system = "light";
  Object.assign(state.app, { credentials: null, welcomeSeen: null, needsOnboarding: false, awaitingSyncConsent: false, displayMode: "standard", themeMode: "auto" });
});
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; });
const hosts = (name: string) => tree!.root.findAllByType(name as never);

it("waits for stored onboarding state before exposing first-run actions", async () => {
  await act(async () => { tree = create(createElement(AppRoot)); });
  expect(hosts("ActivityIndicator")).toHaveLength(1);
  expect(hosts("WelcomeFlow")).toHaveLength(0);
  state.app.welcomeSeen = true;
  await act(async () => tree!.update(createElement(AppRoot)));
  expect(hosts("AppNavigator")).toHaveLength(1);
  expect(hosts("WelcomeFlow")).toHaveLength(0);
});

it.each([
  [false, false, false, "WelcomeFlow"],
  [true, true, true, "OnboardingGate"],
  [true, false, true, "SyncConsentScreen"],
  [true, false, false, "AppNavigator"],
] as const)("keeps the first-run and sync-consent gates in order (%s/%s/%s)", async (signedIn, onboarding, consent, expected) => {
  Object.assign(state.app, { credentials: signedIn ? {} : null, welcomeSeen: signedIn, needsOnboarding: onboarding, awaitingSyncConsent: consent });
  await act(async () => { tree = create(createElement(AppRoot)); });
  expect(hosts(expected)).toHaveLength(1);
});

it("follows live system appearance and preserves an explicit light override", async () => {
  state.app.welcomeSeen = true;
  await act(async () => { tree = create(createElement(AppRoot)); });
  expect(hosts("StatusBar")[0]!.props.style).toBe("dark");
  state.system = "dark";
  await act(async () => tree!.update(createElement(AppRoot)));
  expect(hosts("StatusBar")[0]!.props.style).toBe("light");
  state.app.themeMode = "light";
  await act(async () => tree!.update(createElement(AppRoot)));
  expect(hosts("StatusBar")[0]!.props.style).toBe("dark");
});
