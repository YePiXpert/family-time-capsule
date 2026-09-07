import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
    credentials: null, viewer: null, outbox: [], queued: mocks.queued,
    people: [{ id: "person-1", displayName: "妈妈" }, { id: "person-2", displayName: "外公" }],
  }),
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
  ingestLocalImportSession: vi.fn(), getLocalCaptureDetail: vi.fn().mockResolvedValue(null),
}));
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
vi.mock("../src/drafts/use-draft", () => ({
  usePersistentDraft: () => ({
    draft: mocks.draft,
    drafts: [], saved: true, error: null,
    change: mocks.enqueueText, addOriginal: mocks.enqueueMedia, save: vi.fn(),
    create: vi.fn(), resume: vi.fn(), discard: vi.fn(), retry: vi.fn(),
  }),
}));
const { CaptureScreen } = await import("../src/screens/CaptureScreen");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.draft.content.occurredAt = null;
  mocks.draft.content.occurredAtPrecision = "exact";
  mocks.draft.content.visibility = "family";
  mocks.draft.content.readerUserIds = [];
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
    const input = tree!.root.findAllByType("TextInput" as never)[0]!;
    await act(() => input.props.onChangeText("今天一起散步"));
    await press("保留整件事草稿");
    expect(mocks.enqueueText).toHaveBeenCalledWith({ text: "今天一起散步" });
  } else {
    expect(intent === "photo" ? mocks.camera : mocks.library).toHaveBeenCalledOnce();
    expect(mocks.enqueueMedia).toHaveBeenCalledWith("capture-id", { localUri: "file:///private/photo.jpg" });
  }
  if (intent !== "text") expect(mocks.queued).toHaveBeenCalledOnce();
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

it("offers library import and remains usable when the native camera is unavailable", async () => {
  mocks.camera.mockRejectedValueOnce(Object.assign(new Error("The requested camera is unavailable"), {
    code: "ERR_CAMERA_UNAVAILABLE",
  }));
  await render("photo");
  expect(JSON.stringify(tree!.toJSON())).toContain("当前设备无法使用相机，请从相册导入。");
  expect(mocks.enqueueMedia).not.toHaveBeenCalled();
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

it("精度切换到「到月」把锚点收细为该月首日（§6）", async () => {
  const { zonedWallTimeToUtc } = await import("../src/utils/wall-time");
  mocks.draft.content.occurredAt = "2026-03-15T04:30:00.000Z";
  await render("text");
  await press("到月");
  expect(mocks.enqueueText).toHaveBeenCalledWith({
    occurredAt: expect.any(String),
    occurredAtPrecision: "month",
  });
  const call = mocks.enqueueText.mock.calls.at(-1)![0] as { occurredAt: string };
  // 无论本机时区：锚点折算后应是 2026-03 的首日墙钟（组件用本机时区折算）。
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  expect(call.occurredAt).toBe(zonedWallTimeToUtc("2026-03-01T00:00:00", timezone).toISOString());
});

it("精度切到「不详」清空发生时间且不写锚点（§6）", async () => {
  mocks.draft.content.occurredAt = "2026-03-15T04:30:00.000Z";
  await render("text");
  await press("不详");
  expect(mocks.enqueueText).toHaveBeenCalledWith({
    occurredAt: null,
    occurredAtPrecision: "unknown",
  });
});

it("三档读者选择：切档清空读者（§5）", async () => {
  await render("text");
  await press("仅自己");
  expect(mocks.enqueueText).toHaveBeenCalledWith({ visibility: "private", readerUserIds: [] });
  await press("全家");
  expect(mocks.enqueueText).toHaveBeenCalledWith({ visibility: "family", readerUserIds: [] });
});

it("成员档读者多选与发布守卫（§5）", async () => {
  mocks.draft.content.visibility = "members";
  await render("text");
  await press("妈妈");
  expect(mocks.enqueueText).toHaveBeenCalledWith({ readerUserIds: ["person-1"] });
  // readerUserIds 未回写（仍空）→ 发布被拦并给出可读原因
  mocks.enqueueText.mockClear();
  await press("保存为一条记忆");
  expect(mocks.enqueueText).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).toContain("请先选择可以阅读这件事的家人");
});
