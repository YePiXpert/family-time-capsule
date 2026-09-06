import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), mutate: vi.fn(), get: vi.fn(), set: vi.fn(), remove: vi.fn(), navigate: vi.fn(), state: { credentials: { serverUrl: "https://fixture.invalid", token: "session-a" }, viewer: { id: "user-a", role: "admin", canEditEvents: true }, family: { id: "family-a" }, online: true } }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View", TextInput: "TextInput", StyleSheet: { create: (value: unknown) => value } }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]), useNavigation: () => ({ navigate: mocks.navigate }) }));
vi.mock("../src/state/AppContext", () => ({ useApp: () => mocks.state }));
vi.mock("../src/storage/database", () => ({ getMeta: mocks.get, setMeta: mocks.set, deleteMeta: mocks.remove }));
vi.mock("../src/api/client", async original => ({ ...await original<object>(), fetchOrganizerReview: mocks.fetch, mutateOrganizerReview: mocks.mutate }));
const { OrganizerPanel } = await import("../src/ai/OrganizerPanel");
const { ApiError } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const names = { target: { kind: "inbox_item", id: "item", text: null, source: "rule_generated", revision: 0 }, suggestions: [{ id: "suggestion", title: "窗边的绿色植物", status: "pending", revision: 0, targetRevision: 0, valid: true, canUndo: false }] };
const review = { target: { kind: "inbox_item", id: "item" }, settings: { valid: true, configured: true, configurationId: "test", provider: "专用测试服务", external: true, canConfigure: true, workerAvailable: true, capabilities: ["text", "vision", "transcription"].map(capability => ({ capability, model: "fixture", available: true, consented: true, check: { state: "untested", testedAt: null, code: null } })) }, names: null, transcripts: [], tasks: [] };
const failed = { id: "job", state: "failed", active: false, message: "文字步骤失败", steps: [{ label: "看图", status: "completed" }, { label: "生成标题建议", status: "failed" }], canRetry: true, canCancel: false, canRegenerate: false };
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; vi.resetAllMocks(); mocks.state.online = true; mocks.state.credentials.token = "session-a"; });
const element = () => createElement(OrganizerPanel, { kind: "inbox_item", id: "item" });
function button(label: string) { return tree!.root.findAll(node => String(node.type) === "Pressable" && node.findAll(child => String(child.type) === "Text" && child.props.children === label).length > 0)[0]!; }
async function press(label: string) { const node = button(label); expect(node).toBeTruthy(); expect(node.props.disabled).not.toBe(true); await act(async () => node.props.onPress()); }
async function mount() { await act(async () => { tree = create(element()); }); await press("AI 帮我起名"); }
it("requests naming for the selected target and shows actual results", async () => {
  mocks.fetch.mockResolvedValue(review); mocks.mutate.mockResolvedValue({ ...review, names, tasks: [{ ...failed, state: "ready", message: "整理已完成", canRetry: false, canRegenerate: true, steps: [] }] });
  await mount(); await press("生成标题建议");
  expect(mocks.mutate).toHaveBeenCalledWith(mocks.state.credentials, { kind: "inbox_item", id: "item" }, "name", undefined);
  expect(JSON.stringify(tree!.toJSON())).toContain("窗边的绿色植物"); expect(button("重新生成建议（可能计费）")).toBeTruthy();
});
it("retries the selected failed job and cancels the returned active job", async () => {
  mocks.fetch.mockResolvedValue({ ...review, tasks: [failed] }); mocks.mutate.mockResolvedValue({ ...review, tasks: [{ ...failed, id: "retry", state: "waiting_naming", active: true, canRetry: false, canCancel: true }] });
  await mount(); await press("重试失败步骤");
  expect(mocks.mutate).toHaveBeenLastCalledWith(mocks.state.credentials, { kind: "inbox_item", id: "item" }, "retry", "job"); expect(button("生成标题建议").props.disabled).toBe(true);
  mocks.mutate.mockResolvedValue({ ...review, tasks: [{ ...failed, id: "retry", state: "cancelled" }] }); await press("取消任务");
  expect(mocks.mutate).toHaveBeenLastCalledWith(mocks.state.credentials, { kind: "inbox_item", id: "item" }, "cancel", "retry");
});
it.each([401, 403, 404])("shows offline results but removes revoked cached suggestions on %s", async status => {
  mocks.state.online = false; mocks.get.mockResolvedValue(JSON.stringify({ ...review, names })); await mount();
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(JSON.stringify(tree!.toJSON())).toContain("窗边的绿色植物"); expect(button("生成标题建议").props.disabled).toBe(true);
  mocks.state.online = true; mocks.fetch.mockRejectedValue(new ApiError("denied", status)); await act(async () => tree!.update(element()));
  expect(mocks.remove).toHaveBeenCalledOnce(); expect(JSON.stringify(tree!.toJSON())).not.toContain("窗边的绿色植物");
});
it("discards an old connection's delayed response before caching", async () => {
  let resolve!: (value: unknown) => void; mocks.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; })); await mount();
  mocks.state.credentials = { ...mocks.state.credentials, token: "session-b" }; await act(async () => tree!.update(element())); await act(async () => resolve({ ...review, names }));
  expect(mocks.set).not.toHaveBeenCalled(); expect(JSON.stringify(tree!.toJSON())).not.toContain("窗边的绿色植物");
});
it("keeps naming controls and settings available when AI is unconfigured", async () => {
  mocks.fetch.mockResolvedValue({ ...review, settings: { ...review.settings, configured: false, workerAvailable: false, capabilities: [] } }); await mount();
  expect(button("生成标题建议").props.disabled).toBe(true); expect(JSON.stringify(tree!.toJSON())).toContain("AI 未配置"); expect(button("标题与 AI 建议")).toBeTruthy();
  await press("查看 AI 设置、检测与授权"); expect(mocks.navigate).toHaveBeenCalledWith("Settings");
});
