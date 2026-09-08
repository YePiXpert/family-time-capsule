import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connected: false,
  credentials: { serverUrl: "https://fixture.invalid", instanceId: "instance", token: "test-session" },
  family: { id: "family", name: "测试家庭", timezone: "Asia/Shanghai" },
  grantSyncConsent: vi.fn().mockResolvedValue(undefined),
  items: [] as unknown[],
  constructor: vi.fn(), permission: vi.fn(), audioMode: vi.fn(),
  prepare: vi.fn(), record: vi.fn(), stop: vi.fn(), release: vi.fn(),
  cameraPermission: vi.fn(), camera: vi.fn(), library: vi.fn(),
  enqueueText: vi.fn(), enqueueMedia: vi.fn(), preserveMedia: vi.fn(),
  preserveAudio: vi.fn(), removeFile: vi.fn(), queued: vi.fn(),
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
vi.mock("react-native", () => ({
  Image: "Image", ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView",
  Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: "ios", select: (v: { ios: unknown }) => v.ios },
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
  useNavigation: () => navigation,
  useRoute: () => mocks.route,
}));
const navigation = { setParams: mocks.setParams };
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({
    credentials: mocks.connected ? mocks.credentials : null,
    viewer: mocks.connected ? { canCapture: true, canEditEvents: true } : null,
    family: mocks.connected ? mocks.family : null, userId: mocks.connected ? "user-a" : null,
    grantSyncConsent: mocks.grantSyncConsent,
    outbox: [], queued: mocks.queued,
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
  preservePickedMedia: mocks.preserveMedia, preserveRecordedAudio: mocks.preserveAudio,
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
const { listLocalDrafts } = await import("../src/drafts/store");
const { requestMobileJson } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
beforeEach(async () => {
  mocks.connected = false;
  mocks.grantSyncConsent.mockClear();
  await initializeLocalStore();
  const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");
  getRawMockDatabase().exec("DELETE FROM local_draft");
});

it("R01/R02: selects login User IDs and preserves accountless people only as participants", async () => {
  mocks.connected = true;
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("和妈妈外公一起散步"));
  await press("不详");
  await press("指定成员");
  const allCheckboxes = () => tree!.root.findAllByType("Pressable" as never).filter(n => n.props.accessibilityRole === "checkbox");
  // First two checkboxes are participants; the following ones are login readers.
  const checkboxes = () => allCheckboxes().slice(2);
  expect(checkboxes().map(n => n.findAllByType("Text" as never).map(t => t.children.join("")).join(""))).not.toContain("外公");
  const reader = checkboxes().find(n => n.findAllByType("Text" as never).some(t => t.children.join("") === "妈妈"));
  expect(reader).toBeDefined();
  await act(async () => reader!.props.onPress());
  await act(async () => allCheckboxes()[1]!.props.onPress());
  const scope = JSON.stringify([mocks.credentials.serverUrl, "instance", "user-a", "family"]);
  expect((await listLocalDrafts(scope))[0]?.content.readerUserIds).toEqual(["user-b"]);
  expect((await listLocalDrafts(scope))[0]?.content.participantIds).toEqual(["person-2"]);
  await press("保存为一条记忆");
  expect((await listLocalDrafts(scope))[0]).toMatchObject({ status: "queued", content: { visibility: "members", readerUserIds: ["user-b"], occurredAt: null } });
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
  const node = tree!.root.findAllByType("Pressable" as never).find(n =>
    n.findAllByType("Text" as never).some(t => t.children.join("") === label));
  expect(node, label).toBeDefined();
  await act(async () => { node!.props.onPress(); });
}
it("R03: the recording page and real save hook persist unknown time through reopening", async () => {
  await initializeLocalStore();
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("那次一起去江边，日期已经记不清"));
  await press("不详");
  await press("保存为一条记忆");
  const rows = await listLocalDrafts("local");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "queued", syncIntent: "publish", content: { occurredAt: null, occurredAtPrecision: "unknown", text: "那次一起去江边，日期已经记不清" } });
  await act(async () => tree!.unmount());
  await initializeLocalStore();
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  expect(await listLocalDrafts("local")).toEqual(rows);
  const unknown = tree!.root.findAllByType("Pressable" as never).find(n => n.findAllByType("Text" as never).some(t => t.children.join("") === "不详"));
  expect(unknown?.props.accessibilityState.selected).toBe(true);
});

it.each(["精确", "大约", "只到日", "到月", "到年"])("keeps %s without a date as an editable draft", async label => {
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("暂时只写下故事"));
  await press(label);
  await press("保存为一条记忆");
  expect((await listLocalDrafts("local"))[0]).toMatchObject({ status: "editing", content: { occurredAt: null, text: "暂时只写下故事" } });
  expect(tree!.root.findAllByType("Text" as never).some(t => t.children.join("").includes("请先确认发生时间"))).toBe(true);
});
