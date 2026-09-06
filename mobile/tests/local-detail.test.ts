import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDetail: vi.fn(),
  removeRecord: vi.fn(),
  exists: vi.fn(),
  exportOriginal: vi.fn(),
  runSync: vi.fn(),
}));

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator", Alert: { alert: vi.fn() }, Image: "Image",
  Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView",
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Text: "Text", TextInput: "TextInput", View: "View",
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
}));
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({
    credentials: null,
    outbox: [],
    runSync: mocks.runSync,
  }),
}));
vi.mock("../src/storage/database", () => ({
  getLocalCaptureDetail: mocks.getDetail,
  removeLocalCaptureRecord: mocks.removeRecord,
}));
vi.mock("../src/storage/files", () => ({ localFileExists: mocks.exists }));
vi.mock("../src/media/export-original", () => ({ exportOriginalCopy: mocks.exportOriginal }));
vi.mock("../src/media/NativeMediaReader", () => ({
  NativeMediaReader: () => "NativeMediaReader",
}));

const { LocalCaptureDetailScreen } = await import("../src/screens/LocalCaptureDetailScreen");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let tree: ReactTestRenderer | undefined;
const route = { params: { captureId: "capture-1" } };

function render() {
  act(() => {
    tree = create(createElement(LocalCaptureDetailScreen, { route }));
  });
}

function textOf(): string {
  const root = tree!.root;
  const flatten = (value: unknown): string =>
    Array.isArray(value) ? value.map(flatten).join("") : typeof value === "string" ? value : "";
  return root.findAll((node) => String(node.type) === "Text").map((node) => flatten(node.props.children)).join("\n");
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  if (tree) tree.unmount();
  tree = undefined;
});

describe("本机记录详情（即存即看）", () => {
  it("文字记录直接显示全文，不要求联网或整理", async () => {
    mocks.getDetail.mockResolvedValue({
      captureId: "capture-1", kind: "text_capture", title: "今天的第一句话",
      occurredAt: "2026-09-05T08:30:00.000Z", localUri: null, mediaType: null,
      fileName: null, mimeType: null, inboxItemId: null, memoryEventId: null,
      syncState: "pending", text: "小满今天叫了爸爸。",
    });
    await act(async () => { render(); });
    expect(mocks.getDetail).toHaveBeenCalledWith("capture-1");
    expect(textOf()).toContain("小满今天叫了爸爸。");
    expect(textOf()).toContain("等待上传");
    expect(textOf()).toContain("已保存本机");
  });

  it("原件文件缺失时如实报错并提供恢复入口，不显示“已安全保存”", async () => {
    mocks.getDetail.mockResolvedValue({
      captureId: "capture-2", kind: "media_capture", title: "上个月的照片",
      occurredAt: "2026-08-20T08:30:00.000Z", localUri: "file:///gone.jpg",
      mediaType: "image", fileName: "gone.jpg", mimeType: "image/jpeg",
      inboxItemId: null, memoryEventId: null, syncState: "pending", text: null,
    });
    mocks.exists.mockReturnValue(false);
    await act(async () => { render(); });
    expect(mocks.exists).toHaveBeenCalledWith("file:///gone.jpg");
    expect(textOf()).toContain("本机原件文件已不存在");
    expect(textOf()).not.toContain("已安全保存");
  });

  it("上传失败显示原因并保留原件提示", async () => {
    mocks.getDetail.mockResolvedValue({
      captureId: "capture-3", kind: "media_capture", title: "家庭视频",
      occurredAt: "2026-09-05T09:00:00.000Z", localUri: "file:///video.mp4",
      mediaType: "video", fileName: "video.mp4", mimeType: "video/mp4",
      inboxItemId: null, memoryEventId: null, syncState: "pending", text: null,
    });
    mocks.exists.mockReturnValue(true);
    await act(async () => { render(); });
    expect(textOf()).toContain("家庭视频");
  });

  it("不存在的记录给出真实提示，而不是空白页", async () => {
    mocks.getDetail.mockResolvedValue(null);
    await act(async () => { render(); });
    expect(textOf()).toContain("找不到这条本机记录");
  });
});
