import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Credentials, MobileLibraryDetail } from "../src/types";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), credentials: { serverUrl: "https://synthetic.invalid", token: "a" } as Credentials | null }));
vi.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Alert: {}, FlatList: "FlatList", Pressable: "Pressable", RefreshControl: "RefreshControl", ScrollView: "ScrollView", Share: {}, Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } }));
vi.mock("../src/components/GlassSheet", () => ({ GlassSheetProvider: ({ children }: { children: unknown }) => children, useConfirmSheet: () => vi.fn(async () => true), useAlertSheet: () => vi.fn(async () => {}), confirmSheet: vi.fn(async () => true), alertSheet: vi.fn(async () => {}) }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn,[fn]), useNavigation: () => ({}) }));
vi.mock("react-native-qrcode-svg", () => ({ default: "QRCode" }));
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: "NativeMediaReader" }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("../src/state/AppContext", () => ({ useApp: () => ({ credentials: mocks.credentials, viewer: { role: "viewer" }, online: true, events: [] }) }));
vi.mock("../src/api/client", async original => ({ ...await original<object>(), fetchMobileLibraryDetail: mocks.fetch }));
const { PersonDetailScreen } = await import("../src/screens/LibraryScreens");
const store = await import("../src/storage/database");
const { ApiError } = await import("../src/api/client");
const detail: MobileLibraryDetail = { id: "story", title: "私密来源故事", narratives: [{ id: "p", text: "撤权后不可读的段落" }] };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const render = () => createElement(PersonDetailScreen,{ route: { params: { id: "story" } }, navigation: {} } as never);
const output = () => tree!.root.findAllByType("Text" as never).flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
beforeEach(async () => {
  mocks.credentials = { serverUrl: "https://synthetic.invalid", token: "a" }; mocks.fetch.mockReset();
  await store.initializeLocalStore(); await store.clearLocalArchive(); await store.cacheMobileLibraryDetail("people",detail);
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; });
it.each([401,403,404])("HTTP %i removes the cached person instead of falling back to revoked text", async status => {
  mocks.fetch.mockRejectedValue(new ApiError("denied",status));
  await act(async () => { tree = create(render()); });
  expect(output()).not.toContain("撤权后不可读的段落");
  expect(await store.getCachedMobileLibraryDetail("people","story")).toBeNull();
});
it("a transient transport failure keeps the authorized offline person", async () => {
  mocks.fetch.mockRejectedValue(new ApiError("offline",0));
  await act(async () => { tree = create(render()); });
  expect(output()).toContain("撤权后不可读的段落");
});
it("a permission reset clears rendered person text and rejects the old pending response", async () => {
  let finish!: (value: MobileLibraryDetail) => void;
  mocks.fetch.mockReturnValueOnce(new Promise<MobileLibraryDetail>(resolve => { finish = resolve; })).mockRejectedValue(new ApiError("offline",0));
  await act(async () => { tree = create(render()); });
  expect(output()).toContain("撤权后不可读的段落");
  await act(async () => { await store.clearServerCaches(); });
  await act(async () => { finish(detail); });
  expect(output()).not.toContain("撤权后不可读的段落");
  expect(await store.getCachedMobileLibraryDetail("people","story")).toBeNull();
});
it("switching accounts cannot persist the previous account's delayed response", async () => {
  let finish!: (value: MobileLibraryDetail) => void;
  mocks.fetch.mockReturnValueOnce(new Promise<MobileLibraryDetail>(resolve => { finish = resolve; })).mockRejectedValue(new ApiError("offline",0));
  await act(async () => { tree = create(render()); });
  mocks.credentials = { serverUrl: "https://synthetic.invalid", token: "b" };
  await act(async () => { await store.clearServerCaches(); tree!.update(render()); });
  await act(async () => { finish(detail); });
  expect(output()).not.toContain("撤权后不可读的段落");
  expect(await store.getCachedMobileLibraryDetail("people","story")).toBeNull();
});
