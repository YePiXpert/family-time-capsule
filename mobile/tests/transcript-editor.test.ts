import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), save: vi.fn(), get: vi.fn(), set: vi.fn(), remove: vi.fn(),
  state: { credentials: { serverUrl: "https://fixture.invalid", token: "session-a" }, viewer: { id: "user-a" }, family: { id: "family-a" }, online: true },
}));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: (value: unknown) => value } }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]) }));
vi.mock("../src/state/AppContext", () => ({ useApp: () => mocks.state }));
vi.mock("../src/storage/database", () => ({ getMeta: mocks.get, setMeta: mocks.set, deleteMeta: mocks.remove }));
vi.mock("../src/api/client", async original => ({ ...await original<object>(), fetchTranscriptReview: mocks.fetch, saveTranscriptReview: mocks.save }));
const { TranscriptEditor } = await import("../src/transcripts/TranscriptEditor");
const { ApiError, parseTranscriptReview } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const review = { assetId: "audio", canEdit: true, transcript: { text: "原始全文", edited: false, revision: 3, segments: [] } };
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; vi.resetAllMocks(); mocks.state.online = true; mocks.state.credentials.token = "session-a"; });
const element = () => createElement(TranscriptEditor, { assetId: "audio", label: "录音" });
function button(label: string) { return tree!.root.findAll(node => String(node.type) === "Pressable" && node.findAll(child => String(child.type) === "Text" && child.props.children === label).length > 0)[0]!; }
async function press(label: string) { const node = button(label); expect(node).toBeTruthy(); expect(node.props.disabled).not.toBe(true); await act(async () => node.props.onPress()); }
async function mount() { await act(async () => { tree = create(element()); }); const trigger = tree!.root.findAll(node => String(node.type) === "Pressable")[0]!; await act(async () => trigger.props.onPress()); }
const input = () => tree!.root.findByProps({ accessibilityLabel: "修订转录全文" });

it("preserves input and its revision through conflict until the user compares the latest text", async () => {
  mocks.fetch.mockResolvedValue(review); mocks.save.mockRejectedValueOnce(new ApiError("conflict", 409));
  await mount(); await act(() => input().props.onChangeText("我的全文")); await press("保存转录修订");
  expect(mocks.save).toHaveBeenCalledWith(mocks.state.credentials, "audio", "我的全文", 3);
  expect(input().props.value).toBe("我的全文");
  mocks.fetch.mockResolvedValue({ ...review, transcript: { ...review.transcript, revision: 4, text: "另一端全文" } });
  await press("刷新转录");
  expect(input().props.value).toBe("我的全文");
  expect(button("保存转录修订").props.disabled).toBe(true);
  await press("已核对，保留我的输入");
  mocks.save.mockResolvedValue({ ...review, transcript: { text: "我的全文", edited: true, revision: 5, segments: [] } });
  await press("保存转录修订");
  expect(mocks.save).toHaveBeenLastCalledWith(mocks.state.credentials, "audio", "我的全文", 4);
  expect(button("保存转录修订").props.disabled).toBe(false);
});

it.each([401, 403, 404])("reads offline scoped cache but clears revoked content on %s", async status => {
  mocks.state.online = false; mocks.get.mockResolvedValue(JSON.stringify(review)); await mount();
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(JSON.stringify(tree!.toJSON())).toContain("原始全文");
  expect(button("保存转录修订").props.disabled).toBe(true);
  mocks.state.online = true; mocks.fetch.mockRejectedValue(new ApiError("denied", status));
  await act(async () => tree!.update(element()));
  expect(mocks.remove).toHaveBeenCalledOnce(); expect(JSON.stringify(tree!.toJSON())).not.toContain("原始全文");
});

it("discards responses after switching connections before caching or rendering", async () => {
  let resolve!: (value: typeof review) => void;
  mocks.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; })); await mount();
  mocks.state.credentials = { ...mocks.state.credentials, token: "session-b" };
  await act(async () => tree!.update(element())); await act(async () => resolve(review));
  expect(mocks.set).not.toHaveBeenCalled(); expect(JSON.stringify(tree!.toJSON())).not.toContain("原始全文");
});

it("supports manually clearing text and reading without editing privileges", async () => {
  mocks.fetch.mockResolvedValue(review); mocks.save.mockResolvedValue({ ...review, transcript: { text: "", edited: true, revision: 4, segments: [] } });
  await mount(); await act(() => input().props.onChangeText("")); await press("保存转录修订");
  expect(mocks.save).toHaveBeenCalledWith(mocks.state.credentials, "audio", "", 3);
  expect(JSON.stringify(tree!.toJSON())).toContain("转录已由你清空");
  mocks.fetch.mockResolvedValue({ ...review, canEdit: false }); await press("刷新转录");
  expect(tree!.root.findAllByProps({ accessibilityLabel: "修订转录全文" })).toHaveLength(0);
});

it("rejects malformed revisions and artificial segment alignment on edited transcripts", () => {
  expect(parseTranscriptReview(review)).toEqual(review);
  expect(() => parseTranscriptReview({ ...review, transcript: { ...review.transcript, revision: -1 } })).toThrow(ApiError);
  expect(() => parseTranscriptReview({ ...review, transcript: { ...review.transcript, edited: true, segments: [{ startSeconds: 0, endSeconds: 1, text: "不能对齐" }] } })).toThrow(ApiError);
});
