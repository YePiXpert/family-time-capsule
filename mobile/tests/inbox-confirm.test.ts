import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchInbox: vi.fn(),
  confirmInbox: vi.fn(),
  patchInbox: vi.fn(),
  mergeInbox: vi.fn(),
  archiveLocal: vi.fn(),
  runSync: vi.fn(),
  navigate: vi.fn(),
  focuses: new Set<() => void>(),
}));

const appContext = vi.hoisted(() => ({
  credentials: { serverUrl: "https://example.test", token: "session" },
  people: [{ id: "person-1", displayName: "小满", relationToChild: null }],
  runSync: mocks.runSync,
  viewer: {
    role: "admin",
    canReviewInbox: true,
    canCapture: true,
    canCreateContributions: true,
    canEditEvents: true,
  },
}));

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator", Alert: { alert: vi.fn() }, Image: "Image",
  Modal: "Modal", Platform: { OS: "ios" }, Pressable: "Pressable", ScrollView: "ScrollView",
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Text: "Text", TextInput: "TextInput", View: "View",
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void) => useEffect(() => { mocks.focuses.add(fn); const cleanup = fn(); return () => { mocks.focuses.delete(fn); if (typeof cleanup === "function") (cleanup as () => void)(); }; }, [fn]),
  useNavigation: () => ({ navigate: mocks.navigate }),
}));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: "DateTimePicker",
  DateTimePickerAndroid: { open: vi.fn() },
}));
vi.mock("../src/state/AppContext", () => { const useApp = () => appContext; return { useApp, useAppData: useApp, useAppActions: useApp, useSyncStatus: useApp }; });
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: "NativeMediaReader" }));
vi.mock("../src/api/client", async original => ({
  ...await original<object>(),
  confirmMobileInbox: mocks.confirmInbox,
  fetchMobileInbox: mocks.fetchInbox,
  mergeMobileInbox: mocks.mergeInbox,
  patchMobileInbox: mocks.patchInbox,
}));
vi.mock("../src/storage/database", () => ({ archiveLocalCaptures: mocks.archiveLocal }));
vi.mock("../src/authz/product-access", () => ({ canReviewMobileInbox: () => true }));

const { InboxScreen } = await import("../src/screens/InboxScreen");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = {
  id: "inbox-1",
  kind: "text" as const,
  title: "原始标题",
  titleRevision: 7,
  occurredAtWall: "2026-09-04T18:30",
  locationText: null,
  participantPersonIds: [],
  assets: [],
};

let tree: ReactTestRenderer | undefined;

function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.map(flatten).join("");
  return typeof value === "string" ? value : "";
}

function textOf(): string {
  return tree!.root
    .findAll((node) => String(node.type) === "Text")
    .map((node) => flatten(node.props.children))
    .join("\n");
}

function press(label: string) {
  const target = tree!.root
    .findAll((node) => String(node.type) === "Pressable")
    .find((node) =>
      node.findAll((child) => String(child.type) === "Text").some((child) => flatten(child.props.children) === label),
    );
  if (!target) throw new Error(`button not found: ${label}`);
  act(() => { target.props.onPress(); });
}

async function pressAsync(label: string) {
  const target = tree!.root
    .findAll((node) => String(node.type) === "Pressable")
    .find((node) =>
      node.findAll((child) => String(child.type) === "Text").some((child) => flatten(child.props.children) === label),
    );
  if (!target) throw new Error(`button not found: ${label}`);
  await act(async () => { await target.props.onPress(); });
}

function setInput(value: string) {
  // 编辑卡里的标题输入框（occurredAt 已是选择器控件，不再是 TextInput）
  const titleInput = tree!.root.findAllByType("TextInput" as never)[0]!;
  act(() => { titleInput.props.onChangeText(value); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchInbox.mockResolvedValue({ entries: [ENTRY], nextCursor: null });
  mocks.confirmInbox.mockResolvedValue("memory-1");
  mocks.archiveLocal.mockResolvedValue(undefined);
  mocks.runSync.mockResolvedValue(undefined);
});
afterEach(() => {
  if (tree) tree.unmount();
  tree = undefined;
});

describe("收件箱确认携带当前编辑", () => {
  it("未编辑时确认只提交确认本身", async () => {
    await act(async () => { tree = create(createElement(InboxScreen)); });
    await pressAsync("确认");
    expect(mocks.confirmInbox).toHaveBeenCalledWith(
      { serverUrl: "https://example.test", token: "session" },
      "inbox-1",
      undefined,
      7,
    );
  });

  it("编辑后直接确认会把未保存的标题一并提交（同一事务保存并确认）", async () => {
    await act(async () => { tree = create(createElement(InboxScreen)); });
    press("修改");
    setInput("改好的标题");
    await pressAsync("确认入档");
    expect(mocks.confirmInbox).toHaveBeenCalledWith(
      { serverUrl: "https://example.test", token: "session" },
      "inbox-1",
      expect.objectContaining({ title: "改好的标题" }),
      7,
    );
    expect(mocks.patchInbox).not.toHaveBeenCalled();
    expect(mocks.archiveLocal).toHaveBeenCalledWith(["inbox-1"], "memory-1");
    expect(mocks.navigate).toHaveBeenCalledWith("Memory", { id: "memory-1" });
  });

  it("刷新后的列表确认仍携带旧编辑的修订号，冲突保留输入", async () => {
    await act(async () => { tree = create(createElement(InboxScreen)); });
    press("修改"); setInput("仍在编辑的旧输入");
    mocks.fetchInbox.mockResolvedValue({ entries: [{ ...ENTRY, title: "另一台设备的新标题", titleRevision: 8 }], nextCursor: null });
    await act(async () => { mocks.focuses.forEach(fn => fn()); });
    expect(textOf()).toContain("另一台设备的新标题");
    mocks.confirmInbox.mockRejectedValue(new (await import("../src/api/client")).ApiError("内容已改变，请核对", 409));
    mocks.patchInbox.mockRejectedValue(new (await import("../src/api/client")).ApiError("内容已改变，请核对", 409));
    await pressAsync("确认");
    expect(mocks.confirmInbox).toHaveBeenCalledWith(appContext.credentials, ENTRY.id, expect.objectContaining({ title: "仍在编辑的旧输入" }), 7);
    expect(tree!.root.findAllByType("TextInput" as never)[0]!.props.value).toBe("仍在编辑的旧输入");
    await pressAsync("保存修改");
    expect(mocks.patchInbox).toHaveBeenCalledWith(appContext.credentials, ENTRY.id, expect.objectContaining({ title: "仍在编辑的旧输入", expectedTitleRevision: 7 }));
  });

  it("时间字段是选择器控件而不是 ISO 文本输入", async () => {
    await act(async () => { tree = create(createElement(InboxScreen)); });
    press("修改");
    expect(tree!.root.findAllByType("DateTimePicker" as never).length).toBe(0);
    expect(textOf()).toContain("2026-09-04 18:30");
    expect(textOf()).toContain("清空");
  });
});
