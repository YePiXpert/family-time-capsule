import { revealCaptureAction } from "./capture-controls";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(), keyboard: new Map<string, () => void>(),
  connected: false, syncing: false,
  credentials: { serverUrl: "https://fixture.invalid", instanceId: "instance", token: "test-session" },
  family: { id: "family", name: "测试家庭", timezone: "Asia/Shanghai" },
  grantSyncConsent: vi.fn().mockResolvedValue(undefined),
  items: [] as unknown[],
  constructor: vi.fn(), permission: vi.fn(), audioMode: vi.fn(),
  prepare: vi.fn(), record: vi.fn(), stop: vi.fn(), release: vi.fn(),
  cameraPermission: vi.fn(), camera: vi.fn(), library: vi.fn(),
  enqueueText: vi.fn(), enqueueMedia: vi.fn(), preserveMedia: vi.fn(),
  preserveAudio: vi.fn(), removeFile: vi.fn(), reloadLocal: async () => {}, queued: vi.fn(),
  setParams: vi.fn(), focus: vi.fn(), scrollTo: vi.fn(),
  route: { params: {} as { intent?: string } },
  draft: {
    id: "draft-id", status: "editing", serverRevision: 0,
    content: {
      text: "", title: "", items: [] as unknown[], participantIds: [] as string[],
      occurredAt: null as string | null, occurredAtPrecision: "exact" as const,
      visibility: "family" as "family" | "members" | "private", readerUserIds: [] as string[],
    },
  },
}));
vi.mock("expo-blur", () => ({ BlurTargetView: "BlurTargetView", BlurView: "BlurView" }));
vi.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
vi.mock("expo-glass-effect", () => ({ GlassView: "GlassView", isGlassEffectAPIAvailable: () => false, isLiquidGlassAvailable: () => false }));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect", Circle: "Circle" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("react-native", () => ({
  AccessibilityInfo: { addEventListener: () => ({ remove: () => {} }), isReduceMotionEnabled: async () => true, isReduceTransparencyEnabled: async () => true },
  Alert: { alert: mocks.alert },
  Keyboard: { addListener: (event: string, listener: () => void) => { mocks.keyboard.set(event, listener); return { remove: () => mocks.keyboard.delete(event) }; } },
  Image: "Image", ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView", KeyboardAvoidingView: "KeyboardAvoidingView",
  Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: "ios", select: (v: { ios: unknown }) => v.ios },
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
  useNavigation: () => navigation,
  useRoute: () => mocks.route,
}));
const navigation = { setParams: mocks.setParams, navigate: vi.fn() };
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({ syncing: mocks.syncing,
    credentials: mocks.connected ? mocks.credentials : null,
    viewer: mocks.connected ? { canCapture: true, canEditEvents: true } : null,
    family: mocks.connected ? mocks.family : null, userId: mocks.connected ? "user-a" : null,
    grantSyncConsent: mocks.grantSyncConsent,
    outbox: [], queued: mocks.queued, reloadLocal: mocks.reloadLocal,
    people: [{ id: "person-1", displayName: "妈妈" }, { id: "person-2", displayName: "外公" }],
  }),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-audio", () => {
  class Recorder {
    constructor(options: unknown) { mocks.constructor(options); }
    uri = "file:///recording.m4a";
    prepareToRecordAsync = mocks.prepare;
    record = mocks.record;
    stop = mocks.stop;
    release = mocks.release;
  }
  return {
    AudioModule: { AudioRecorder: Recorder },
    // Model the former eager hook too, so this suite reproduces the old render crash.
    useAudioRecorder: () => new Recorder({}),
    RecordingPresets: { HIGH_QUALITY: { extension: ".m4a", ios: { outputFormat: "aac" } } },
    requestRecordingPermissionsAsync: mocks.permission,
    setAudioModeAsync: mocks.audioMode,
  };
});
vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: mocks.cameraPermission,
  launchCameraAsync: mocks.camera, launchImageLibraryAsync: mocks.library,
  UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
  UIImagePickerControllerQualityType: { High: "high" },
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("../src/storage/files", () => ({
  preparePickedMedia: mocks.preserveMedia, preservePreparedMedia: vi.fn().mockResolvedValue(undefined), preservePickedMedia: mocks.preserveMedia, preserveRecordedAudio: mocks.preserveAudio,
  preservePickedDocument: vi.fn(), removeLocalFile: mocks.removeFile,
}));
vi.mock("../src/native/picker-intake", () => ({ beginPickerReceipt: vi.fn(), finishPickerReceipt: vi.fn() }));
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: "NativeMediaReader" }));
vi.mock("../src/components/DateTimeField", () => ({ DateTimeField: "DateTimeField" }));
vi.mock("@react-native-community/datetimepicker", () => ({
  DateTimePickerAndroid: { open: vi.fn() },
  default: "DateTimePicker",
}));

vi.mock("../src/api/client", () => ({ requestMobileJson: vi.fn(async (_credentials, path) => {
  if (path === "/api/mobile/v1/draft-readers") return { members: [{ id: "user-b", name: "妈妈" }, { id: "user-c", name: "另一成员" }] };
  return { drafts: [] };
}) }));
const { CaptureScreen } = await import("../src/screens/CaptureScreen");
const { initializeLocalStore } = await import("../src/storage/database");
const { listLocalDrafts, saveLocalDraft } = await import("../src/drafts/store");
const { preservePreparedMedia } = await import("../src/storage/files");
const { requestMobileJson } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
beforeEach(async () => {
  mocks.alert.mockClear();
  mocks.connected = false; mocks.syncing = false;
  vi.mocked(preservePreparedMedia).mockReset().mockResolvedValue(undefined);
  mocks.grantSyncConsent.mockClear();
  await initializeLocalStore();
  const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");
  getRawMockDatabase().exec("DELETE FROM local_draft");
});

it("R01/R02: selects login User IDs and preserves accountless people only as participants", async () => {
  mocks.connected = true;
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("和妈妈外公一起散步"));
  await seedMetadata({ occurredAtPrecision: "unknown", participantIds: ["person-2"] });
  await press("指定成员");
  const allCheckboxes = () => tree!.root.findAllByType("Pressable" as never).filter(n => n.props.accessibilityRole === "checkbox");
  // Only account readers belong on the quick capture page.
  const checkboxes = allCheckboxes;
  expect(checkboxes().map(n => n.findAllByType("Text" as never).map(t => t.children.join("")).join(""))).not.toContain("外公");
  const reader = checkboxes().find(n => n.findAllByType("Text" as never).some(t => t.children.join("") === "妈妈"));
  expect(reader).toBeDefined();
  await act(async () => reader!.props.onPress());
  const scope = JSON.stringify([mocks.credentials.serverUrl, "instance", "user-a", "family"]);
  expect((await listLocalDrafts(scope))[0]?.content.readerUserIds).toEqual(["user-b"]);
  expect((await listLocalDrafts(scope))[0]?.content.participantIds).toEqual(["person-2"]);
  await press("保存");
  expect((await listLocalDrafts(scope)).find(d => d.status === "queued")).toMatchObject({ status: "queued", content: { visibility: "members", readerUserIds: ["user-b"], occurredAt: null } });
  expect(mocks.grantSyncConsent).toHaveBeenCalledOnce();
});

it("retries reader lookup after network recovery and lets the author remove a departed selection without widening visibility", async () => {
  const request = vi.mocked(requestMobileJson), original = request.getMockImplementation()!;
  let offline = true, removed = false;
  request.mockImplementation(async (_credentials, path) => {
    if (path !== "/api/mobile/v1/draft-readers") return { drafts: [] };
    if (offline) throw new Error("offline");
    return { members: removed ? [] : [{ id: "user-b", name: "妈妈" }] };
  });
  try {
    mocks.connected = true;
    await act(async () => { tree = create(createElement(CaptureScreen)); });
    await press("指定成员");
    expect(tree!.root.findAllByType("Text" as never).some(t => t.children.join("").includes("暂时无法核对登录成员"))).toBe(true);
    offline = false;
    await press("重新核对成员");
    const reader = tree!.root.findAllByType("Pressable" as never).filter(n => n.props.accessibilityRole === "checkbox").at(-1)!;
    await act(async () => reader.props.onPress());
    removed = true;
    await press("重新核对成员");
    const scope = JSON.stringify([mocks.credentials.serverUrl, "instance", "user-a", "family"]);
    expect((await listLocalDrafts(scope))[0]?.content).toMatchObject({ visibility: "members", readerUserIds: ["user-b"] });
    await press("已选成员（待联网核对，点按移除）");
    expect((await listLocalDrafts(scope))[0]?.content).toMatchObject({ visibility: "members", readerUserIds: [] });
  } finally { request.mockImplementation(original); }
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); });
async function press(label: string) {
  await revealCaptureAction(tree!, label);
  const node = tree!.root.findAllByType("Pressable" as never).find(n =>
    n.props.accessibilityLabel === label || n.findAllByType("Text" as never).some(t => t.children.join("") === label));
  expect(node, label).toBeDefined();
  await act(async () => { node!.props.onPress(); });
}
it("R03: the recording page and real save hook persist unknown time through reopening", async () => {
  await initializeLocalStore();
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("那次一起去江边，日期已经记不清"));
  await seedMetadata({ occurredAtPrecision: "unknown" });
  await press("保存");
  const rows = await listLocalDrafts("local");
  expect(rows).toHaveLength(2);
  expect(rows.find(d => d.status === "queued")).toMatchObject({ status: "queued", syncIntent: "publish", content: { occurredAt: null, occurredAtPrecision: "unknown", text: "那次一起去江边，日期已经记不清" } });
  await act(async () => tree!.unmount());
  await initializeLocalStore();
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  expect(await listLocalDrafts("local")).toEqual(rows);
  expect(tree!.root.findByProps({ testID: "capture-text" }).props.value).toBe("");
  expect((await listLocalDrafts("local")).find(d => d.status === "queued")?.content.occurredAtPrecision).toBe("unknown");
});

it.each(["exact", "approximate", "date_only", "month", "year"] as const)("recovers an incomplete legacy %s date without inventing a date", async precision => {
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("暂时只写下故事"));
  await seedMetadata({ occurredAtPrecision: precision });
  await press("保存");
  expect((await listLocalDrafts("local"))[0]).toMatchObject({ status: "editing", content: { occurredAt: null, text: "暂时只写下故事" } });
  await press("标为时间不确定");
  await press("保存");
  expect((await listLocalDrafts("local")).find(d => d.status === "queued")?.content.occurredAtPrecision).toBe("unknown");
});

it("keeps a picked Live Photo image and paired video together through real SQLite reopen and removal", async () => {
  const image = { uri: "file:///picker/still.heic", type: "livePhoto", pairedVideoAsset: { uri: "file:///picker/motion.mov", type: "pairedVideo" } };
  mocks.library.mockResolvedValue({ canceled: false, assets: [image] });
  mocks.preserveMedia.mockImplementation(async (asset, id) => ({ localUri: `file:///copies/${id}`, fileName: asset.type === "pairedVideo" ? "motion.mov" : "still.heic", mediaType: asset.type === "pairedVideo" ? "video" : "image", mimeType: asset.type === "pairedVideo" ? "video/quicktime" : "image/heic", source: "library", lastModified: null }));
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await press("相册");
  await expect.poll(async () => (await listLocalDrafts("local"))[0]?.content.items.length).toBe(2);
  const row = (await listLocalDrafts("local"))[0]!;
  expect(row.content.items.map(i => i.livePhotoRole)).toEqual(["image", "video"]);
  expect(new Set(row.content.items.map(i => i.livePhotoGroupId)).size).toBe(1);
  expect(row.content.items[0]?.livePhotoGroupId).toBeTruthy();
  const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");
  expect(getRawMockDatabase().prepare("SELECT count(*) n FROM local_capture WHERE id IN (?,?)").get(...row.content.items.map(i => i.localCaptureRef))).toEqual({ n: 2 });
  await act(async () => tree!.unmount());
  await initializeLocalStore();
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  expect((await listLocalDrafts("local"))[0]?.content.items).toEqual(row.content.items);
  await press("移除");
  expect((await listLocalDrafts("local"))[0]?.content.items).toEqual([]);
  expect(getRawMockDatabase().prepare("SELECT count(*) n FROM local_capture WHERE id IN (?,?)").get(...row.content.items.map(i => i.localCaptureRef))).toEqual({ n: 2 });
});

it("does not save a half Live Photo when the paired copy fails", async () => {
  vi.mocked(preservePreparedMedia).mockImplementation(async uri => { if (uri === "file:///motion") throw new Error("video copy failed"); });
  mocks.library.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///still", type: "livePhoto", pairedVideoAsset: { uri: "file:///motion", type: "pairedVideo" } }] });
  mocks.preserveMedia.mockImplementation(async (asset, id) => {

    return { localUri: `file:///copies/${id}`, fileName: "still.heic", mediaType: "image", mimeType: "image/heic", source: "library", lastModified: null };
  });
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await press("相册");
  await expect.poll(() => tree!.root.findAllByType("Text" as never).some(t => t.children.join("").includes("video copy failed"))).toBe(true);
  expect((await listLocalDrafts("local"))[0]?.content.items).toEqual([]);
});

it.each(["保存"])("blocks %s for a recovered Live Photo with a missing component", async action => {
  mocks.connected = true;
  const scope = JSON.stringify([mocks.credentials.serverUrl, "instance", "user-a", "family"]);
  const { createLocalDraft, saveLocalDraft } = await import("../src/drafts/store");
  const row = await createLocalDraft(scope, crypto.randomUUID(), crypto.randomUUID());
  const items = (["image", "video"] as const).map(role => ({ id: crypto.randomUUID(), assetId: null, localCaptureRef: null, caption: "复制中断", preservationState: "missing" as const, livePhotoGroupId: "incomplete-pair", livePhotoRole: role }));
  await saveLocalDraft({ ...row, revision: 2, content: { ...row.content, items, occurredAtPrecision: "unknown" } }, 1);
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await press(action);
  expect((await listLocalDrafts(scope))[0]?.status).toBe("editing");
  expect(tree!.root.findAllByType("Text" as never).some(t => t.children.join("").includes("原件复制中断或缺失"))).toBe(true);
  expect(mocks.grantSyncConsent).not.toHaveBeenCalled();
});

it("pairs separately imported image and video only after an explicit user action", async () => {
  mocks.library.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///still.jpg", type: "image" }, { uri: "file:///motion.mov", type: "video" }] });
  mocks.preserveMedia.mockImplementation(async (asset, id) => ({ localUri: `file:///copies/${id}`, fileName: asset.type === "video" ? "motion.mov" : "still.jpg", mediaType: asset.type, mimeType: asset.type === "video" ? "video/quicktime" : "image/jpeg", source: "library", lastModified: null }));
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await press("相册");
  await expect.poll(async () => (await listLocalDrafts("local"))[0]?.content.items.length).toBe(2);
  expect((await listLocalDrafts("local"))[0]?.content.items.every(i => !i.livePhotoGroupId)).toBe(true);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  await press("与上一张照片组成 Live Photo");
  const items = (await listLocalDrafts("local"))[0]!.content.items;
  expect(items.map(i => i.livePhotoRole)).toEqual(["image", "video"]);
  expect(items[0]!.livePhotoGroupId).toBe(items[1]!.livePhotoGroupId);
});

it("quick capture queues text with the current time and prepares the next record without menus", async () => {
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  expect(tree!.root.findAllByProps({ accessibilityLabel: "记忆标题" })).toHaveLength(0);
  expect(tree!.root.findAllByType("Pressable" as never).filter(node => node.props.accessibilityRole === "checkbox")).toHaveLength(0);
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("只写一句话，先留下来"));
  await press("保存");
  expect((await listLocalDrafts("local")).find(d => d.status === "queued")).toMatchObject({ status: "queued", syncIntent: "publish", organizeOnPublish: false, content: { title: "", occurredAt: expect.any(String), text: "只写一句话，先留下来" } });
  const saveBar = tree!.root.findByProps({ testID: "capture-save-bar" });
  expect(tree!.root.findByProps({ testID: "capture-text" }).props.value).toBe("");
  expect(saveBar.findByProps({ testID: "capture-save" }).props.disabled).toBe(true);
});

it("refreshes publication status after sync and starts the next record without losing the saved one", async () => {
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("小美今天的笑脸"));
  await press("保存");
  const draft = (await listLocalDrafts("local")).find(d => d.status === "queued")!;
  await act(async () => { mocks.syncing = true; tree!.update(createElement(CaptureScreen)); });
  await saveLocalDraft({ ...draft, status: "published", memoryEventId: "saved-memory", revision: draft.revision + 1 }, draft.revision);
  await act(async () => { mocks.syncing = false; tree!.update(createElement(CaptureScreen)); });
  expect(JSON.stringify(tree!.toJSON())).not.toContain("记录下一刻");
  expect(tree!.root.findByProps({ testID: "capture-text" }).props.value).toBe("");
  expect((await listLocalDrafts("local")).find(row => row.id === draft.id)).toMatchObject({ status: "published", content: { text: "小美今天的笑脸" } });
});

async function seedMetadata(patch: Partial<import("../src/drafts/model").DraftContent>) {
  const scope = mocks.connected ? JSON.stringify([mocks.credentials.serverUrl, "instance", "user-a", "family"]) : "local";
  const row = (await listLocalDrafts(scope)).find(d => d.status === "editing")!;
  await act(async () => { tree!.unmount(); });
  await saveLocalDraft({ ...row, content: { ...row.content, ...patch }, captureTimeEdited: true, revision: row.revision + 1 }, row.revision);
  await act(async () => { tree = create(createElement(CaptureScreen)); });
}

it("keeps save reachable above the keyboard and retains the chosen audience for the next note", async () => {
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await press("仅自己");
  await act(async () => {
    tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("键盘打开也能直接保存");
    mocks.keyboard.get("keyboardDidShow")!();
  });
  const bar = tree!.root.findByProps({ testID: "capture-save-bar" });
  expect(bar.props.style.at(-1).bottom).toBe(8);
  expect(bar.findByProps({ testID: "capture-save" }).props.disabled).toBe(false);
  await press("保存");
  const rows = await listLocalDrafts("local");
  expect(rows.find(d => d.status === "queued")?.content).toMatchObject({ visibility: "private", text: "键盘打开也能直接保存" });
  expect(rows.find(d => d.status === "editing")?.content).toMatchObject({ visibility: "private", text: "" });
});

it("clears only after confirmation and keeps the discarded record durable", async () => {
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("暂时不要清空"));
  await press("清空");
  expect(tree!.root.findByProps({ testID: "capture-text" }).props.value).toBe("暂时不要清空");
  const confirm = mocks.alert.mock.calls[0]![2].find((button: { text: string }) => button.text === "清空");
  await act(async () => { confirm.onPress(); });
  expect(tree!.root.findByProps({ testID: "capture-text" }).props.value).toBe("");
  expect((await listLocalDrafts("local")).find(d => d.status === "discarded")?.content.text).toBe("暂时不要清空");
});

it("retains the same record when queueing fails and retries without duplicate publication", async () => {
  const store = await import("../src/drafts/store");
  const queue = vi.spyOn(store, "queueDraftOriginals").mockRejectedValueOnce(new Error("队列暂时无法写入"));
  try {
    await act(async () => { tree = create(createElement(CaptureScreen)); });
    await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("失败也不能丢失的记录"));
    await press("保存");
    const original = (await listLocalDrafts("local"))[0]!;
    expect(tree!.root.findByProps({ testID: "capture-text" }).props.value).toBe("失败也不能丢失的记录");
    expect(await listLocalDrafts("local")).toHaveLength(1);
    await press("继续同步");
    expect((await listLocalDrafts("local")).filter(d => d.content.text)).toMatchObject([{ id: original.id, status: "queued" }]);
    expect(tree!.root.findByProps({ testID: "capture-text" }).props.value).toBe("");
  } finally { queue.mockRestore(); }
});

it("offers the queued record in pending work while the composer is ready for the next note", async () => {
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("从待处理找回的记录"));
  await press("保存");
  const queued = (await listLocalDrafts("local")).find(d => d.status === "queued")!;
  const { PendingScreen } = await import("../src/screens/PendingScreen");
  await act(async () => { tree!.update(createElement(PendingScreen)); });
  await press("从待处理找回的记录");
  expect(navigation.navigate).toHaveBeenLastCalledWith("Capture", { localDraftId: queued.id });
});
