import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), mutate: vi.fn(), get: vi.fn(), set: vi.fn(), remove: vi.fn(), sync: vi.fn(),
  state: { credentials: { serverUrl: "https://fixture.invalid", token: "session-a" }, viewer: { id: "user-a", canEditEvents: true }, family: { id: "family-a" }, online: true },
}));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: (value: unknown) => value } }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]) }));
vi.mock("../src/state/AppContext", () => ({ useApp: () => ({ ...mocks.state, runSync: mocks.sync }) }));
vi.mock("../src/storage/database", () => ({ getMeta: mocks.get, setMeta: mocks.set, deleteMeta: mocks.remove }));
vi.mock("../src/api/client", async importOriginal => ({ ...await importOriginal<object>(), fetchNameReview: mocks.fetch, mutateNameReview: mocks.mutate }));
const { NameEditor } = await import("../src/names/NameEditor");
const { ApiError } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const review = { target: { kind: "memory_event", id: "event", text: "旧名称", source: "legacy_unknown", revision: 3 }, suggestions: [{ id: "suggestion", title: "窗边读书", status: "pending", revision: 2, targetRevision: 3, valid: true, canUndo: false }] };
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; vi.resetAllMocks(); mocks.state.online = true; mocks.state.credentials.token = "session-a"; });
function button(label: string) { return tree!.root.findAll(node => String(node.type) === "Pressable" && node.findAll(child => String(child.type) === "Text" && child.props.children === label).length > 0)[0]!; }
async function press(label: string) { const node = button(label); expect(node).toBeTruthy(); await act(async () => node.props.onPress()); }
async function mount() { await act(async () => { tree = create(createElement(NameEditor, { kind: "memory_event", id: "event" })); }); await press("标题与 AI 建议"); }

it("keeps typed input after conflict and refresh while submitting target revisions", async () => {
  mocks.fetch.mockResolvedValue(review); mocks.mutate.mockRejectedValue(new ApiError("conflict", 409));
  await mount();
  const manual = tree!.root.findByProps({ accessibilityLabel: "人工名称" });
  await act(() => manual.props.onChangeText("我的输入不能丢失"));
  await press("保存人工名称");
  expect(mocks.mutate).toHaveBeenCalledWith(mocks.state.credentials, { kind: "memory_event", id: "event", revision: 3, operation: "rename", title: "我的输入不能丢失" });
  expect(manual.props.value).toBe("我的输入不能丢失");
  mocks.fetch.mockResolvedValue({ ...review, target: { ...review.target, text: "另一端的名称", revision: 4 } });
  await press("刷新名称与建议");
  expect(manual.props.value).toBe("我的输入不能丢失");
});

it("adopts an explicitly chosen title and refreshes synchronization", async () => {
  mocks.fetch.mockResolvedValue(review);
  mocks.mutate.mockResolvedValue({ ...review, target: { ...review.target, text: "窗边读书", source: "accepted_ai", revision: 4 }, suggestions: [] });
  await mount(); await press("采用");
  expect(mocks.mutate).toHaveBeenCalledWith(mocks.state.credentials, { kind: "memory_event", id: "event", revision: 3, operation: "accept", suggestionId: "suggestion", suggestionRevision: 2 });
  expect(mocks.sync).toHaveBeenCalledOnce();
  expect(tree!.root.findByProps({ accessibilityLabel: "人工名称" }).props.value).toBe("窗边读书");
});

it("allows offline reading of scoped cache, then clears revoked cache on 403", async () => {
  mocks.state.online = false; mocks.get.mockResolvedValue(JSON.stringify(review));
  await mount();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).toContain("窗边读书");
  expect(button("采用").props.disabled).toBe(true);
  mocks.state.online = true; mocks.fetch.mockRejectedValue(new ApiError("forbidden", 403));
  await act(async () => tree!.update(createElement(NameEditor, { kind: "memory_event", id: "event" })));
  expect(mocks.remove).toHaveBeenCalledOnce();
  expect(JSON.stringify(tree!.toJSON())).not.toContain("窗边读书");
});

it("discards an old account response before caching or rendering it", async () => {
  let resolve!: (value: typeof review) => void;
  mocks.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount();
  mocks.state.credentials = { ...mocks.state.credentials, token: "session-b" };
  await act(async () => tree!.update(createElement(NameEditor, { kind: "memory_event", id: "event" })));
  await act(async () => resolve(review));
  expect(mocks.set).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).not.toContain("窗边读书");
});
