import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyDraftContent } from "../src/drafts/model";
import type { LibraryPage, LibraryDetail } from "../src/assets/types";
const mocks = vi.hoisted(() => ({ request: vi.fn(), mutateCollection: vi.fn(), alert: vi.fn(), confirm: vi.fn(async (_options?: unknown) => false), navigation: { navigate: vi.fn(), replace: vi.fn() }, app: { credentials: { serverUrl: "https://fictional.example.test", token: "fictional-token", instanceId: "instance-a" }, userId: "user-a", family: { id: "family-a", timezone: "Asia/Shanghai" }, viewer: { role: "admin", canEditEvents: true }, people: [{ id: "person-a", displayName: "外公" }] } }));
vi.mock("react-native", () => ({ Image: "Image", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: (v: unknown) => v }, Alert: { alert: mocks.alert } }));
vi.mock("../src/components/GlassSheet", () => ({ GlassSheetProvider: ({ children }: { children: unknown }) => children, useConfirmSheet: () => mocks.confirm, useAlertSheet: () => vi.fn(async () => {}), confirmSheet: (options: unknown) => mocks.confirm(options), alertSheet: vi.fn(async () => {}) }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]), useNavigation: () => mocks.navigation }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "new-draft-id" }));
vi.mock("../src/state/AppContext", () => { const useApp = () => mocks.app; return { useApp, useAppData: useApp, useAppActions: useApp, useSyncStatus: useApp }; });
vi.mock("../src/api/client", () => ({ requestMobileJson: mocks.request, mutateCollection: mocks.mutateCollection }));
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: "NativeMediaReader" }));
vi.mock("../src/ai/OrganizerPanel", () => ({ OrganizerPanel: "OrganizerPanel" }));
vi.mock("../src/components/DateTimeField", () => ({ DateTimeField: "DateTimeField" }));
const { AssetLibraryScreen, AssetDetailScreen, NativeLibraryActions } = await import("../src/screens/AssetLibraryScreen");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const page = (count = 30): LibraryPage => ({ entries: Array.from({ length: count }, (_, i) => ({ id: `asset-${i}`, title: `家庭原件 ${i}`, type: "image", mimeType: "image/jpeg", previewId: null, capturedAt: null, referenced: false, syncState: "received", aiState: "none" })), nextCursor: null, canWrite: true, canCapture: true, pendingDeletions: [] });
const detail = (): LibraryDetail => ({ ...page(1).entries[0]!, type: "audio", mimeType: "audio/mp4", metadataRevision: 2, nameRevision: 0, participantIds: [], canWrite: true, canCapture: true, canDelete: true, memories: [], technical: { originalFilename: "recording.m4a", sha256: "a".repeat(64), bytes: 12, width: null, height: null, durationMs: 1000, metadataJson: null, importedAt: "2026-09-01T00:00:00Z", timeSource: "import_time", importSources: ["share"] } });
beforeEach(() => { vi.clearAllMocks(); mocks.mutateCollection.mockReset(); mocks.navigation.navigate.mockReset(); mocks.confirm.mockReset().mockResolvedValue(false); mocks.app.userId = "user-a"; mocks.app.viewer = { role: "admin", canEditEvents: true }; });
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; });
async function press(title: string) { const button = tree!.root.findAll(n => String(n.type) === "Pressable" && n.findAll(c => String(c.type) === "Text" && c.props.children === title).length > 0)[0]!; expect(button).toBeTruthy(); await act(async () => button.props.onPress()); }
it("shows all 30 originals and adds five references to a single persistent draft", async () => {
  mocks.request.mockResolvedValue(page()); await act(async () => { tree = create(createElement(AssetLibraryScreen)); });
  const selectors = tree!.root.findAll(n => n.props.accessibilityRole === "checkbox" && String(n.type) === "Pressable"); expect(selectors).toHaveLength(30);
  for (const checkbox of selectors.slice(0, 5)) await act(async () => checkbox.props.onPress());
  mocks.request.mockResolvedValue({}); await press("加入一条新记忆");
  expect(JSON.parse(mocks.request.mock.lastCall?.[2].body)).toMatchObject({ operation: "draft", assetIds: ["asset-0", "asset-1", "asset-2", "asset-3", "asset-4"], targetId: "new-draft-id" });
  expect(mocks.navigation.navigate).toHaveBeenCalledWith("MainTabs", { screen: "Capture", params: { draftId: "new-draft-id" } });
  expect(tree!.root.findAll(n => n.props.accessibilityRole === "checkbox" && String(n.type) === "Pressable")).toHaveLength(30);
});
it("opens an unorganized recording, edits people/time and requires explicit confirmation before deletion", async () => {
  mocks.request.mockResolvedValue(detail()); await act(async () => { tree = create(createElement(AssetDetailScreen, { route: { params: { id: "asset-0" } } })); });
  expect(tree!.root.findAll(n => String(n.type) === "NativeMediaReader")[0]!.props.assets[0]).toMatchObject({ id: "asset-0", type: "audio" });
  const checkbox = tree!.root.findAll(n => String(n.type) === "Pressable" && n.props.accessibilityRole === "checkbox")[0]!;
  await act(async () => checkbox.props.onPress()); await press("保存时间与人物");
  expect(JSON.parse(mocks.request.mock.lastCall?.[2].body)).toEqual({ revision: 2, capturedAt: null, participantIds: ["person-a"] });
  await press("删除原件"); expect(mocks.request.mock.lastCall?.[2].method).toBe("PATCH");
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "永久删除原件", confirmLabel: "确认永久删除", destructive: true }));
  expect(mocks.request.mock.lastCall?.[2].method).toBe("PATCH");
  mocks.confirm.mockResolvedValue(true); mocks.request.mockResolvedValue({ deleted: true, cleanupPending: true }); await press("删除原件");
  expect(mocks.request.mock.lastCall?.[2].method).toBe("DELETE"); expect(mocks.navigation.replace).toHaveBeenCalledWith("AssetLibrary");
});
it("discards a late response after account switch and keeps viewer actions read-only", async () => {
  let finish!: (value: LibraryPage) => void; mocks.request.mockReturnValueOnce(new Promise<LibraryPage>(resolve => { finish = resolve; }));
  await act(async () => { tree = create(createElement(AssetLibraryScreen)); });
  mocks.app.userId = "user-b"; mocks.app.viewer = { role: "viewer", canEditEvents: false };
  mocks.request.mockResolvedValue({ ...page(1), entries: [{ ...page(1).entries[0], title: "当前账号合法原件" }], canCapture: false, canWrite: false });
  await act(async () => tree!.update(createElement(AssetLibraryScreen))); await act(async () => finish(page()));
  expect(JSON.stringify(tree!.toJSON())).toContain("当前账号合法原件"); expect(JSON.stringify(tree!.toJSON())).not.toContain("家庭原件 29"); expect(JSON.stringify(tree!.toJSON())).not.toContain("加入一条新记忆");
});

it("adds selected assets to an album, then applies the chosen cover using the returned revision", async () => {
  const added = { id: "album", revision: 7, title: "家庭相册", items: [{ id: "existing", assetId: "asset-existing" }], coverAssetId: null };
  const done = vi.fn();
  mocks.request.mockResolvedValueOnce({ entries: [{ id: "album", title: "家庭相册", revision: 6 }], nextCursor: null }).mockResolvedValueOnce(added);
  mocks.mutateCollection.mockResolvedValue({ ...added, coverAssetId: "asset-1" });
  await act(async () => { tree = create(createElement(NativeLibraryActions, { ids: ["asset-0", "asset-1"], canWrite: true, coverAssetId: "asset-1", onDone: done })); });
  await press("加入相册"); await press("家庭相册");
  expect(JSON.parse(mocks.request.mock.lastCall![2].body)).toMatchObject({ operation: "collection", targetId: "album", revision: 6, assetIds: ["asset-0", "asset-1"] });
  expect(mocks.mutateCollection).toHaveBeenCalledWith(mocks.app.credentials, "album", { operation: "save", revision: 7, edit: { ...added, coverAssetId: "asset-1" } });
  expect(done).toHaveBeenCalledOnce(); expect(mocks.navigation.navigate).not.toHaveBeenCalled();
});

it("reports a cover-only failure as partial success without repeating the completed album insertion", async () => {
  const done = vi.fn();
  mocks.request.mockResolvedValueOnce({ entries: [{ id: "album", title: "家庭相册", revision: 6 }] }).mockResolvedValueOnce({ id: "album", revision: 7 });
  mocks.mutateCollection.mockRejectedValue(new Error("cover write failed"));
  await act(async () => { tree = create(createElement(NativeLibraryActions, { ids: ["asset-0"], canWrite: true, coverAssetId: "asset-0", onDone: done })); });
  await press("加入相册"); await press("家庭相册");
  expect(JSON.stringify(tree!.toJSON())).toContain("所选资料已加入相册，封面暂未更新");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("cover write failed");
  expect(mocks.request.mock.calls.filter(args => args[2]?.method === "POST")).toHaveLength(1);
  expect(done).toHaveBeenCalledOnce();
});

it("saves the chosen draft cover and closes the picker before navigating to the new draft", async () => {
  const sequence: string[] = [];
  const onNavigate = vi.fn(() => sequence.push("close picker"));
  const draft = { ...emptyDraftContent(), id: "new-draft-id", revision: 4, items: [
    { id: "item-0", assetId: "asset-0", localCaptureRef: null, caption: "" },
    { id: "item-1", assetId: "asset-1", localCaptureRef: null, caption: "" },
  ] };
  mocks.request.mockResolvedValueOnce(draft).mockResolvedValueOnce({ ...draft, coverItemId: "item-1", revision: 5 });
  mocks.navigation.navigate.mockImplementation(() => sequence.push("navigate"));
  await act(async () => { tree = create(createElement(NativeLibraryActions, { ids: ["asset-0", "asset-1"], canWrite: true, coverAssetId: "asset-1", onNavigate })); });
  await press("加入一条新记忆");
  const coverWrite = mocks.request.mock.calls.find(args => args[1] === "/api/mobile/v1/drafts/new-draft-id")!;
  expect(JSON.parse(coverWrite[2].body)).toMatchObject({ expectedRevision: 4, content: { coverItemId: "item-1" } });
  expect(sequence).toEqual(["close picker", "navigate"]);
  expect(mocks.navigation.navigate).toHaveBeenCalledWith("MainTabs", { screen: "Capture", params: { draftId: "new-draft-id" } });
});
