import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

const fixture = JSON.parse(process.env.FTC_NATIVE_HTTP_FIXTURE!);
const mocks = vi.hoisted(() => ({
  constructor: vi.fn(), permission: vi.fn(), audioMode: vi.fn(), prepare: vi.fn(), record: vi.fn(), stop: vi.fn(), release: vi.fn(),
  cameraPermission: vi.fn(), camera: vi.fn(), library: vi.fn(), preserveMedia: vi.fn(), preserveAudio: vi.fn(), removeFile: vi.fn(),
  setParams: vi.fn(), route: { params: {} }, grantSyncConsent: vi.fn().mockResolvedValue(undefined), queued: vi.fn(),
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
vi.mock("../src/state/AppContext", () => ({ useApp: () => ({
  credentials: fixture.credentials, family: fixture.family, userId: fixture.userId,
  people: fixture.people, viewer: { canCapture: true, canEditEvents: true },
  outbox: [], queued: mocks.queued, grantSyncConsent: mocks.grantSyncConsent,
}) }));
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

const { CaptureScreen } = await import("../src/screens/CaptureScreen");
const { initializeLocalStore, setActiveDestination } = await import("../src/storage/database");
const { listLocalDrafts } = await import("../src/drafts/store");
const { syncLocalDrafts } = await import("../src/drafts/sync");
const { requestMobileJson } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); });
async function press(label: string) {
  const node = tree!.root.findAllByType("Pressable" as never).find(n => n.findAllByType("Text" as never).some(t => t.children.join("") === label));
  expect(node, label).toBeDefined();
  await act(async () => { node!.props.onPress(); });
}
it("R01/R02/R03: real native recording hook → HTTP DTO → production API → SQLite → reader isolation", async () => {
  await initializeLocalStore();
  const scope = JSON.stringify([fixture.credentials.serverUrl, fixture.credentials.instanceId, fixture.userId, fixture.family.id]);
  await setActiveDestination(scope);
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  // Real network requests are outside React's synchronous render lifetime.
  await expect.poll(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    return tree!.root.findByProps({ testID: "capture-text" }).props.editable;
  }).toBe(true);
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("日期不详的江边往事"));
  await press("不详");
  await press("指定成员");
  await expect.poll(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    return tree!.root.findAllByType("Pressable" as never).filter(n => n.props.accessibilityRole === "checkbox").length;
  }).toBe(fixture.people.length + fixture.readerCount);
  const boxes = tree!.root.findAllByType("Pressable" as never).filter(n => n.props.accessibilityRole === "checkbox");
  const readers = boxes.slice(fixture.people.length);
  expect(readers.some(n => n.findAllByType("Text" as never).some(t => t.children.join("") === "外公"))).toBe(false);
  const reader = readers.find(n => n.findAllByType("Text" as never).some(t => t.children.join("") === "妈妈"));
  await act(async () => reader!.props.onPress());
  await act(async () => boxes[1]!.props.onPress());
  await press("保存为一条记忆");
  expect(mocks.grantSyncConsent).toHaveBeenCalledOnce();
  const before = (await listLocalDrafts(scope))[0]!;
  expect(before).toMatchObject({ status: "queued", content: { readerUserIds: ["user-b"], participantIds: ["person-no-account"], occurredAtPrecision: "unknown", occurredAt: null } });
  await act(async () => tree!.unmount()); tree = undefined;
  await initializeLocalStore();
  expect((await listLocalDrafts(scope))[0]).toEqual(before);
  await syncLocalDrafts(fixture.credentials, { authorizeUpload: async () => true });
  const published = (await listLocalDrafts(scope))[0]!;
  expect(published.status).toBe("published");
  expect(published.content.occurredAt).toBeNull();
  const url = `/api/mobile/v1/memories/${published.memoryEventId}`;
  expect(await requestMobileJson(fixture.credentials, url)).toMatchObject({ occurredAtPrecision: "unknown" });
  expect(await requestMobileJson({ ...fixture.credentials, token: fixture.readerToken }, url)).toMatchObject({ id: published.memoryEventId });
  await expect(requestMobileJson({ ...fixture.credentials, token: fixture.thirdToken }, url)).rejects.toMatchObject({ status: 404 });
}, 30000);
