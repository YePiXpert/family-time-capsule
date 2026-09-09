import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), navigate: vi.fn(),
  state: {
    credentials: { serverUrl: "https://fixture.invalid", token: "synthetic-session" },
    viewer: { id: "user-a", role: "owner" }, family: { id: "family-a" }, online: true,
  },
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable", Text: "Text", View: "View", ScrollView: "ScrollView",
  Alert: { alert: vi.fn() }, Linking: { openURL: vi.fn() },
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
  useNavigation: () => ({ navigate: mocks.navigate }),
}));
vi.mock("../src/state/AppContext", () => ({ useApp: () => mocks.state }));
vi.mock("../src/storage/database", () => ({ getMeta: vi.fn(), setMeta: vi.fn(), deleteMeta: vi.fn() }));
vi.mock("../src/api/client", async original => ({ ...await original<object>(), fetchAiSettings: mocks.fetch }));
const { AiSettingsSection } = await import("../src/ai/AiSettingsSection");
const { SettingsHubScreen } = await import("../src/screens/SettingsHubScreen");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; vi.clearAllMocks(); });

it.each(["owner", "admin", "editor", "contributor", "viewer"])("shows AI settings according to the %s role", async role => {
  mocks.state.viewer.role = role;
  mocks.fetch.mockResolvedValue({ valid: true, configured: true, provider: "Synthetic provider", workerAvailable: true, capabilities: [] });
  await act(async () => { tree = create(createElement(AiSettingsSection)); });
  const allowed = ["owner", "admin", "editor"].includes(role);
  expect(mocks.fetch).toHaveBeenCalledTimes(allowed ? 1 : 0);
  expect(JSON.stringify(tree!.toJSON()).includes("AI 整理与隐私")).toBe(allowed);
});

it.each(["owner", "admin", "editor", "contributor", "viewer"])("limits invitations to managers when logged in as %s", async role => {
  mocks.state.viewer.role = role;
  await act(async () => { tree = create(createElement(SettingsHubScreen)); });
  await act(async () => tree!.root.find(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === "家人和账号").props.onPress());
  const buttons = tree!.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === "邀请家人加入");
  expect(buttons).toHaveLength(["owner", "admin"].includes(role) ? 1 : 0);
  if (buttons.length) {
    await act(async () => buttons[0]!.props.onPress());
    expect(mocks.navigate).toHaveBeenCalledWith("InviteFamily");
  }
});

it.each([0, 100])("distinguishes unlimited usage from an explicitly configured request limit of %s", async maxRequests => {
  mocks.state.viewer.role = "owner";
  mocks.fetch.mockResolvedValue({
    valid: true, configured: true, provider: "Synthetic provider", workerAvailable: true, capabilities: [],
    quota: { day: "2026-09-09", limits: { maxRequests, maxImages: 0, maxAudioSeconds: 0 }, used: { requests: 3, images: 1, audioSeconds: 2 } },
  });
  await act(async () => { tree = create(createElement(AiSettingsSection)); });
  expect(JSON.stringify(tree!.toJSON()).includes("自用模式 · 不设每日限额")).toBe(maxRequests === 0);
});
