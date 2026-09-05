import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { defaultBookLayout, type BookDetail } from "../src/books/types";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  mutate: vi.fn(),
  materials: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
  credentials: {
    serverUrl: "https://fictional.example.test",
    token: "fictional-component-token",
  },
}));
vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
  Alert: { alert: vi.fn() },
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
  usePreventRemove: vi.fn(),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "new-fictional-block" }));
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({ credentials: mocks.credentials }),
}));
vi.mock("../src/api/client", () => ({
  fetchBook: mocks.get,
  fetchBooks: mocks.list,
  mutateBook: mocks.mutate,
  fetchBookMaterials: mocks.materials,
  createNativeBook: mocks.create,
}));
const { BooksScreen, BookDetailScreen } =
  await import("../src/screens/BookScreens");
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  vi.clearAllMocks();
});
function detail(): BookDetail {
  return {
    id: "book",
    title: "虚构成长册",
    subtitle: "出生第一周",
    template: "growth",
    audience: "family",
    pageSize: "A5",
    startDate: null,
    endDate: null,
    coverAssetId: null,
    revision: 2,
    ownerPersonId: "dad",
    status: "active",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
    canWrite: true,
    timezone: "Asia/Shanghai",
    chapters: [{ id: "chapter", title: "第一章" }],
    blocks: ["first", "second"].map((id) => ({
      id,
      chapterId: "chapter",
      kind: "text",
      text: `虚构内容 ${id}`,
      caption: "",
      layout: defaultBookLayout(),
      sourceIds: [],
    })),
    sources: [],
    sourceStates: {},
    blockedBlockIds: [],
    warnings: [],
    versions: [],
  };
}
async function press(label: string, index = 0) {
  const button = tree!.root.findAll(
    (n) =>
      String(n.type) === "Pressable" &&
      n.findAll((c) => String(c.type) === "Text" && c.props.children === label)
        .length > 0,
  )[index]!;
  expect(button).toBeTruthy();
  expect(button.props.disabled).not.toBe(true);
  await act(async () => button.props.onPress());
}
async function field(label: string, value: string, index = 0) {
  const input = tree!.root.findAll(
    (n) =>
      String(n.type) === "TextInput" && n.props.accessibilityLabel === label,
  )[index]!;
  expect(input).toBeTruthy();
  await act(() => input.props.onChangeText(value));
}
it("creates a real native shelf project with explicit template and audience, then navigates to its editor", async () => {
  mocks.list.mockResolvedValue({
    entries: [],
    nextCursor: null,
    canWrite: true,
  });
  mocks.create.mockResolvedValue("new-book");
  await act(async () => {
    tree = create(
      createElement(BooksScreen, {
        navigation: { navigate: mocks.navigate },
        route: {},
      } as unknown as Parameters<typeof BooksScreen>[0]),
    );
  });
  await field("作品标题", "虚构家人的来信");
  await press("家人来信集：以每位家人的讲述为中心，留下署名和日期。");
  await press("建立作品");
  expect(mocks.create).toHaveBeenCalledWith(
    mocks.credentials,
    "虚构家人的来信",
    "letters",
    "family",
  );
  expect(mocks.navigate).toHaveBeenCalledWith("BookDetail", { id: "new-book" });
});
it("edits and reorders native content, keeps text on conflict and selects actual server materials", async () => {
  mocks.get.mockResolvedValue(detail());
  mocks.mutate.mockRejectedValue(new Error("其他家人已保存修改"));
  mocks.materials.mockResolvedValue({
    entries: [{ id: "memory", title: "虚构窗边阅读", kind: "memory" }],
    nextCursor: null,
  });
  await act(async () => {
    tree = create(
      createElement(BookDetailScreen, {
        navigation: { navigate: mocks.navigate },
        route: { params: { id: "book" } },
      } as unknown as Parameters<typeof BookDetailScreen>[0]),
    );
  });
  await press("基础编辑");
  await field("正文", "我保留的手工文字");
  await press("内容下移");
  await press("保存版本快照");
  expect(
    mocks.mutate.mock.lastCall?.[2].edit.blocks.map(
      (b: { id: string }) => b.id,
    ),
  ).toEqual(["second", "first"]);
  expect(JSON.stringify(tree!.toJSON())).toContain("其他家人已保存修改");
  expect(
    tree!.root.findAll(
      (n) =>
        String(n.type) === "TextInput" && n.props.value === "我保留的手工文字",
    ),
  ).toHaveLength(1);
  mocks.mutate.mockImplementation(async (_c, _id, input) =>
    input.operation === "save"
      ? { ...input.edit, revision: 3 }
      : { ...detail(), revision: 4 },
  );
  await press("重试保存");
  await press("从记忆、相册或故事选材");
  await press("虚构窗边阅读");
  await press("加入 1 项");
  expect(mocks.mutate.mock.lastCall?.[2]).toEqual({
    operation: "add",
    revision: 3,
    selection: [{ kind: "memory", id: "memory" }],
  });
  expect(JSON.stringify(tree!.toJSON())).toContain("已保存 · 版本 4");
});
it("does not replace typing made while autosave is in flight", async () => {
  mocks.get.mockResolvedValue(detail());
  let finish!: (v: BookDetail) => void;
  mocks.mutate.mockImplementation(
    () =>
      new Promise<BookDetail>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    tree = create(
      createElement(BookDetailScreen, {
        navigation: { navigate: mocks.navigate },
        route: { params: { id: "book" } },
      } as unknown as Parameters<typeof BookDetailScreen>[0]),
    );
  });
  await press("基础编辑");
  await field("副标题", "第一次输入");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 950));
  });
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  await field("副标题", "请求期间的新输入");
  await act(() => finish({ ...detail(), subtitle: "第一次输入", revision: 3 }));
  expect(
    tree!.root.findAll(
      (n) =>
        String(n.type) === "TextInput" && n.props.value === "请求期间的新输入",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(tree!.toJSON())).toContain("有未保存修改");
});
