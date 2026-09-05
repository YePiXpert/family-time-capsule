import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(), permission: vi.fn(), audioMode: vi.fn(),
  prepare: vi.fn(), record: vi.fn(), stop: vi.fn(), release: vi.fn(),
  cameraPermission: vi.fn(), camera: vi.fn(), library: vi.fn(),
  enqueueText: vi.fn(), enqueueMedia: vi.fn(), preserveMedia: vi.fn(),
  preserveAudio: vi.fn(), removeFile: vi.fn(), queued: vi.fn(),
  setParams: vi.fn(), focus: vi.fn(), scrollTo: vi.fn(),
  route: { params: {} as { intent?: string } },
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView",
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
  useApp: () => ({ credentials: null, viewer: null, outbox: [], queued: mocks.queued }),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "capture-id" }));
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
vi.mock("../src/storage/database", () => ({
  enqueueTextCapture: mocks.enqueueText, enqueueMediaCapture: mocks.enqueueMedia,
  ingestLocalImportSession: vi.fn(),
}));
vi.mock("../src/storage/files", () => ({
  preservePickedMedia: mocks.preserveMedia, preserveRecordedAudio: mocks.preserveAudio,
  preservePickedDocument: vi.fn(), removeLocalFile: mocks.removeFile,
}));
vi.mock("../src/native/picker-intake", () => ({ beginPickerReceipt: vi.fn(), finishPickerReceipt: vi.fn() }));
const { CaptureScreen } = await import("../src/screens/CaptureScreen");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.route.params = {};
  mocks.permission.mockResolvedValue({ granted: true });
  mocks.cameraPermission.mockResolvedValue({ granted: true });
  mocks.camera.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///photo.jpg" }] });
  mocks.library.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///photo.jpg" }] });
  mocks.preserveMedia.mockResolvedValue({ localUri: "file:///private/photo.jpg" });
  mocks.preserveAudio.mockResolvedValue({ localUri: "file:///private/recording.m4a" });
});
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  vi.useRealTimers();
});
async function render(intent?: string) {
  mocks.route.params = { intent };
  await act(async () => {
    tree = create(createElement(CaptureScreen), {
      createNodeMock: (element) => element.type === "TextInput"
        ? { focus: mocks.focus } : { scrollTo: mocks.scrollTo },
    });
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(60); });
}
async function press(label: string) {
  const button = tree!.root.findAll((n) => String(n.type) === "Pressable" &&
    n.findAll((c) => String(c.type) === "Text" && c.props.children === label).length > 0)[0]!;
  expect(button).toBeTruthy();
  expect(button.props.disabled).toBeFalsy();
  await act(async () => { button.props.onPress(); });
}

it.each(["text", "photo", "library"])("opens %s and saves without initializing audio", async (intent) => {
  mocks.constructor.mockImplementation(() => { throw new Error("Failed to create recorder"); });
  await render(intent);
  if (intent === "text") {
    expect(mocks.focus).toHaveBeenCalledOnce();
    const input = tree!.root.findByType("TextInput" as never);
    await act(() => input.props.onChangeText("今天一起散步"));
    await press("保存文字");
    expect(mocks.enqueueText).toHaveBeenCalledWith("capture-id", { text: "今天一起散步" });
  } else {
    expect(intent === "photo" ? mocks.camera : mocks.library).toHaveBeenCalledOnce();
    expect(mocks.enqueueMedia).toHaveBeenCalledWith("capture-id", { localUri: "file:///private/photo.jpg" });
  }
  expect(mocks.queued).toHaveBeenCalledOnce();
  expect(mocks.constructor).not.toHaveBeenCalled();
  expect(mocks.permission).not.toHaveBeenCalled();
  expect(mocks.audioMode).not.toHaveBeenCalled();
});

it("keeps capture usable when microphone permission is denied", async () => {
  mocks.permission.mockResolvedValue({ granted: false });
  await render();
  await press("直接录音");
  expect(JSON.stringify(tree!.toJSON())).toContain("需要麦克风权限");
  expect(mocks.constructor).not.toHaveBeenCalled();
  await press("从相册导入");
  expect(mocks.enqueueMedia).toHaveBeenCalledOnce();
});

it.each(["constructor", "prepare", "record"] as const)("contains %s failure and can retry recording", async (step) => {
  mocks[step].mockImplementationOnce(() => { throw new Error("录音设备不可用"); });
  await render();
  await press("直接录音");
  expect(JSON.stringify(tree!.toJSON())).toContain("录音设备不可用");
  expect(mocks.audioMode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false }));
  if (step !== "constructor") expect(mocks.release).toHaveBeenCalledOnce();
  await press("直接录音");
  expect(JSON.stringify(tree!.toJSON())).toContain("完成录音");
  expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(mocks.constructor.mock.invocationCallOrder[0]!);
  expect(mocks.audioMode.mock.invocationCallOrder[0]).toBeLessThan(mocks.constructor.mock.invocationCallOrder[0]!);
  await press("完成录音");
  expect(mocks.enqueueMedia).toHaveBeenCalledWith("capture-id", { localUri: "file:///private/recording.m4a" });
  expect(mocks.release).toHaveBeenCalled();
});

it("releases the recorder and restores other capture actions after stop fails", async () => {
  mocks.stop.mockRejectedValueOnce(new Error("录音已中断"));
  await render();
  await press("直接录音");
  await press("完成录音");
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.enqueueMedia).not.toHaveBeenCalled();
  await press("拍照片");
  expect(mocks.camera).toHaveBeenCalledOnce();
});

it("does not lose the saved result if resetting the audio session fails", async () => {
  await render();
  await press("直接录音");
  mocks.audioMode.mockRejectedValueOnce(new Error("session reset failed"));
  await press("完成录音");
  expect(JSON.stringify(tree!.toJSON())).toContain("录音原件已复制");
  expect(mocks.enqueueMedia).toHaveBeenCalledOnce();
  await press("拍照片");
});

it("releases a live recorder when the screen unmounts", async () => {
  await render();
  await press("直接录音");
  await act(() => tree!.unmount());
  tree = undefined;
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.audioMode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false }));
});

it("does not create a recorder if unmounted while waiting for permission", async () => {
  let grant!: (value: { granted: boolean }) => void;
  mocks.permission.mockReturnValue(new Promise((resolve) => { grant = resolve; }));
  await render();
  await press("直接录音");
  await act(() => tree!.unmount());
  tree = undefined;
  await act(async () => { grant({ granted: true }); });
  expect(mocks.constructor).not.toHaveBeenCalled();
  expect(mocks.audioMode).not.toHaveBeenCalled();
});
