import { createElement, useEffect, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), consent: vi.fn(async () => {}), sync: vi.fn(async () => {}), reload: vi.fn(async () => {}), account: "a", cachedAccount: null as string | null, viewer: false, live: true, online: true, connected: true, sequence: 0, focus: 0, holdSave: null as Promise<void> | null }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("react-native", () => ({
  Image: "Image", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
  FlatList: (props: { data: unknown[]; ListHeaderComponent?: ReactNode; ListFooterComponent?: ReactNode; renderItem: (args: { item: unknown; index: number }) => ReactNode }) => createElement("FlatList", props, props.ListHeaderComponent, props.data.map((item, index) => createElement("Cell", { key: index }, props.renderItem({ item, index }))), props.ListFooterComponent),
  StyleSheet: { create: (s: unknown) => s, absoluteFill: {} },
}));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "Icon" }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn, mocks.focus]) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `intake-screen-${++mocks.sequence}` }));
vi.mock("../src/state/AppContext", () => { const useApp = () => ({ credentials: mocks.connected ? { serverUrl: "https://fixture.invalid", instanceId: "instance", token: "fictional" } : null, userId: mocks.connected && mocks.live ? mocks.account : null, family: { id: "family", name: "测试家庭" }, viewer: { id: mocks.cachedAccount ?? mocks.account, role: mocks.viewer ? "viewer" : "admin", canCapture: !mocks.viewer }, online: mocks.online, reloadLocal: mocks.reload, runSync: mocks.sync, grantSyncConsent: mocks.consent, syncConsent: null }); return { useApp, useAppData: useApp, useAppActions: useApp, useSyncStatus: useApp }; });
vi.mock("../src/imports/photo-selection-store", async original => {
  const actual = await original<typeof import("../src/imports/photo-selection-store")>();
  return { ...actual, savePhotoSelection: async (...args: Parameters<typeof actual.savePhotoSelection>) => {
    const hold = mocks.holdSave; mocks.holdSave = null;
    if (hold) await hold;
    return actual.savePhotoSelection(...args);
  } };
});
const store = await import("../src/storage/database");
const { LocalIntakeScreen } = await import("../src/screens/LocalIntakeScreen");
const { listLocalDrafts, createLocalDraft } = await import("../src/drafts/store");
const { loadPhotoSelection, savePhotoSelection, drainPhotoSelectionWrites } = await import("../src/imports/photo-selection-store");
const { createPhotoSelection } = await import("../src/imports/photo-selection");
const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const scope = JSON.stringify(["https://fixture.invalid", "instance", "a", "family"]);
const photo = (id: string) => ({ externalId: id, captureId: id, kind: "file" as const, payload: { localUri: `file:///private/${id}.jpg`, fileName: `${id}.jpg`, mimeType: "image/jpeg", mediaType: "image" as const, lastModified: null, source: "files" as const } });
function props(id: string) { return { route: { key: id, name: "LocalIntake", params: { id } }, navigation: { navigate: mocks.navigate } } as unknown as Parameters<typeof LocalIntakeScreen>[0]; }
function button(label: string) { return tree!.root.findAll(node => String(node.type) === "Pressable" && (node.props.accessibilityLabel === label || node.findAllByType("Text" as never).some(text => text.children.join("") === label)))[0]!; }
function renderedText() { return tree!.root.findAllByType("Text" as never).flatMap(node => node.children.filter(child => typeof child === "string")).join(" "); }
async function settle() { await act(async () => { await Promise.resolve(); await drainPhotoSelectionWrites(); }); }
async function press(label: string) { const control = button(label); expect(control, label).toBeDefined(); expect(control.props.disabled, label).toBeFalsy(); await act(async () => control.props.onPress()); await settle(); }
async function render(id: string) { await act(async () => { tree = create(createElement(LocalIntakeScreen, props(id))); }); await settle(); }
async function seed(id: string, items: Parameters<typeof store.ingestLocalImportSession>[0]["items"], owner = scope) { await store.ingestLocalImportSession({ id, scope: owner, source: "share", createdAt: "2026-09-07T00:00:00Z", queue: false, items }); }
beforeEach(async () => { await drainPhotoSelectionWrites(); await store.initializeLocalStore(); await store.clearLocalArchive(); vi.clearAllMocks(); mocks.viewer = false; mocks.account = "a"; mocks.cachedAccount = null; mocks.live = true; mocks.online = true; mocks.connected = true; mocks.focus = 0; mocks.holdSave = null; });
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; await drainPhotoSelectionWrites(); getRawMockDatabase().exec("DROP TRIGGER IF EXISTS fail_screen_selection"); });

it("continues a mixed receipt after leaving the screen, without waiting for network or publishing an isolated event", async () => {
  await seed("mixed", [{ externalId: "text", captureId: "screen-text", kind: "text", payload: { text: "外公留下的那段故事" } }, { externalId: "audio", captureId: "screen-audio", kind: "file", payload: { localUri: "file:///private/story.wav", fileName: "讲述.wav", mimeType: "audio/wav", mediaType: "audio", lastModified: null, source: "system_share" } }]);
  await render("mixed");
  await press("全部展开");
  await press("查看原件：讲述.wav");
  expect(mocks.navigate).toHaveBeenCalledWith("LocalCapture", { captureId: "screen-audio" });
  expect((await store.getLocalCaptureDetail("screen-audio"))?.localUri).toBe("file:///private/story.wav");
  await press("将所选加入新草稿");
  const draft = (await listLocalDrafts(scope))[0]!;
  expect(draft.content.text).toBe("外公留下的那段故事"); expect(draft.content.items).toHaveLength(1); expect(draft.status).toBe("editing");
  expect(mocks.consent).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.navigate).toHaveBeenCalledWith("MainTabs", expect.objectContaining({ screen: "Capture", params: expect.objectContaining({ localDraftId: draft.id }) }));
  await act(() => tree!.unmount()); tree = undefined; await render("mixed");
  expect(button("查看关联草稿")).toBeDefined();
  await press("全部展开");
  expect(button("选中 外公留下的那段故事").props.disabled).toBe(true);
  mocks.account = "b";
  await act(async () => tree!.update(createElement(LocalIntakeScreen, props("mixed"))));
  expect(renderedText()).not.toContain("外公留下的那段故事");
});

it("keeps a viewer's received originals readable while offering no family write operation", async () => {
  mocks.viewer = true;
  await seed("viewer-receipt", [{ externalId: "text", captureId: "viewer-text", kind: "text", payload: { text: "先留在我自己的手机" } }]);
  await render("viewer-receipt"); await press("全部展开");
  expect(renderedText()).toContain("先留在我自己的手机");
  expect(button("选中 先留在我自己的手机").props.disabled).toBe(true);
  expect(button("将所选加入新草稿")).toBeUndefined();
  expect(button("全选").props.disabled).toBe(true);
  await press("查看原件：先留在我自己的手机");
  expect(mocks.navigate).toHaveBeenCalledWith("LocalCapture", { captureId: "viewer-text" });
  expect(mocks.consent).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
});

it("cold-starts offline with cached identity, restores family selection and writes only a local family-scoped draft", async () => {
  mocks.live = false; mocks.online = false;
  await seed("offline", [photo("a"), photo("b")]);
  const initial = createPhotoSelection([{ id: "a", title: "a.jpg", type: "image" }, { id: "b", title: "b.jpg", type: "image" }]);
  await savePhotoSelection(scope, "offline", { ...initial, selectedIds: ["b"], coverId: "b" }, 0);
  await render("offline"); await press("全部展开");
  expect(button("选中 a.jpg").props.accessibilityState.checked).toBe(false);
  expect(button("选中 b.jpg").props.accessibilityState.checked).toBe(true);
  expect(button("上传全部原件到家庭资料库 · 测试家庭").props.disabled).toBe(true);
  await press("将所选加入新草稿");
  expect((await listLocalDrafts(scope))[0]?.content.items.map(item => item.localCaptureRef)).toEqual(["b"]);
  expect(await listLocalDrafts("local")).toEqual([]);
  expect(await loadPhotoSelection("local", "offline")).toBeNull();
  expect(mocks.consent).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  expect(getRawMockDatabase().prepare("SELECT COUNT(*) n FROM outbox").get()).toEqual({ n: 0 });
});

it("does not trust a cached identity that contradicts the live account", async () => {
  await seed("private", [{ externalId: "text", captureId: "private-text", kind: "text", payload: { text: "账号A的原文" } }]);
  mocks.account = "b"; mocks.cachedAccount = "a";
  await render("private");
  expect(renderedText()).not.toContain("账号A的原文");
  expect(button("将所选加入新草稿")).toBeUndefined();
  expect(await loadPhotoSelection("local", "private")).toBeNull();
});

it("inherits an unbound local selection into a fresh family revision without overwriting the local snapshot", async () => {
  await seed("unbound", [photo("a"), photo("b")], "local");
  let local = createPhotoSelection([{ id: "a", title: "a", type: "image" }, { id: "b", title: "b", type: "image" }]);
  local = await savePhotoSelection("local", "unbound", { ...local, selectedIds: ["b"], coverId: "b" }, 0);
  local = await savePhotoSelection("local", "unbound", local, 1);
  await render("unbound");
  expect(await loadPhotoSelection(scope, "unbound")).toMatchObject({ revision: 1, selectedIds: ["b"], coverId: "b" });
  expect(await loadPhotoSelection("local", "unbound")).toEqual(local);
  expect(mocks.consent).not.toHaveBeenCalled();
});

it("preserves the latest input across failed autosave and focus changes, blocks submission, and retries the same selection", async () => {
  await seed("disk", [photo("a"), photo("b")]); await render("disk"); await press("全部展开");
  getRawMockDatabase().exec("CREATE TRIGGER fail_screen_selection BEFORE UPDATE ON local_import_selection BEGIN SELECT RAISE(ABORT,'disk full'); END");
  await press("选中 a.jpg");
  expect(button("选中 a.jpg").props.accessibilityState.checked).toBe(false);
  expect(button("将所选加入新草稿").props.disabled).toBe(true);
  expect((await loadPhotoSelection(scope, "disk"))?.selectedIds).toEqual(["a", "b"]);
  mocks.focus++;
  await act(async () => tree!.update(createElement(LocalIntakeScreen, props("disk"))));
  expect(button("选中 a.jpg").props.accessibilityState.checked).toBe(false);
  expect(renderedText()).toContain("disk full");
  getRawMockDatabase().exec("DROP TRIGGER fail_screen_selection");
  await press("重试保存挑选");
  expect((await loadPhotoSelection(scope, "disk"))?.selectedIds).toEqual(["b"]);
  expect(button("将所选加入新草稿").props.disabled).toBe(false);
});

it("keeps malformed persisted selection intact and offers the preserved originals for inspection", async () => {
  await seed("broken", [photo("a")]); await render("broken");
  await act(() => tree!.unmount()); tree = undefined;
  getRawMockDatabase().prepare("UPDATE local_import_selection SET snapshot_json='broken' WHERE scope=?").run(scope);
  await render("broken");
  expect(button("将所选加入新草稿")).toBeUndefined();
  await press("查看原件：a.jpg");
  await press("重新读取");
  expect(getRawMockDatabase().prepare("SELECT snapshot_json FROM local_import_selection WHERE scope=?").get(scope)).toEqual({ snapshot_json: "broken" });
  expect((await store.getLocalCaptureDetail("a"))?.localUri).toBe("file:///private/a.jpg");
});

it("preserves all originals locally then allows a separate explicit upload, and supports choosing an existing draft", async () => {
  await seed("library", [photo("a"), photo("b")]); await render("library");
  await press("仅选代表图");
  await press("仅存本机资料库 · 保留全部原件");
  expect(getRawMockDatabase().prepare("SELECT COUNT(*) n FROM outbox").get()).toEqual({ n: 0 });
  expect(mocks.consent).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  await press("上传全部原件到家庭资料库 · 测试家庭");
  expect(mocks.consent).toHaveBeenCalledWith("selected", ["a", "b"]);
  expect(mocks.sync).toHaveBeenCalledOnce();
  const existing = await createLocalDraft(scope, "existing", "create-existing");
  mocks.focus++;
  await act(async () => tree!.update(createElement(LocalIntakeScreen, props("library")))); await settle();
  await press("将所选加入已有草稿 · 1 份"); await press("未命名的一件事");
  expect((await listLocalDrafts(scope)).find(draft => draft.id === existing.id)?.content.items.map(item => item.localCaptureRef)).toEqual(["a"]);
});


it("coalesces rapid changes behind a pending save and uses the newly committed revision for the final snapshot", async () => {
  await seed("rapid", [photo("a"), photo("b"), photo("c")]); await render("rapid"); await press("全部展开");
  let release!: () => void;
  mocks.holdSave = new Promise<void>(resolve => { release = resolve; });
  await act(() => button("选中 a.jpg").props.onPress());
  await act(() => button("选中 b.jpg").props.onPress());
  expect(button("将所选加入新草稿").props.disabled).toBe(true);
  await act(async () => { release(); }); await settle();
  expect(await loadPhotoSelection(scope, "rapid")).toMatchObject({ selectedIds: ["c"], revision: 3, coverId: null });
  expect(button("将所选加入新草稿").props.disabled).toBe(false);
});
