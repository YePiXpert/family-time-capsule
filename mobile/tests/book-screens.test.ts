import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultBookLayout, type BookDetail } from "../src/books/types";
import { ApiError } from "../src/api/client";
import type { Credentials } from "../src/types";
import type { DownloadEntry } from "../src/reading/engine";
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: () => null }));
vi.mock("../src/components/GlassSheet", () => ({ GlassSheetProvider: ({ children }: { children: unknown }) => children, useConfirmSheet: () => vi.fn(async () => true), useAlertSheet: () => vi.fn(async () => {}), confirmSheet: vi.fn(async () => true), alertSheet: vi.fn(async () => {}) }));
vi.mock("../src/components/CollapsingHero", () => ({ useCollapsingHeroScroll: () => ({ scrollY: { interpolate: () => 0 }, onScroll: () => {} }), CollapsingHero: "CollapsingHero", CollapsingHeroBar: "CollapsingHeroBar" }));
vi.mock("../src/design/haptics", () => ({ haptics: { success: vi.fn(), warning: vi.fn(), selection: vi.fn(), impact: vi.fn() }, setHapticsEnabled: vi.fn(), areHapticsEnabled: () => true }));
vi.mock("../src/growth/GrowthBookCard", () => ({ GrowthBookCard: () => null }));
vi.mock("../src/reading/DownloadButton", () => ({ ReadingDownloadButton: () => null }));
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  mutate: vi.fn(),
  materials: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
  online: true,
  scope: vi.fn(),
  downloads: vi.fn(),
  download: vi.fn(),
  listeners: new Set<(key?: string) => void>(),
  invalidate: vi.fn(),
  credentials: {
    serverUrl: "https://fictional.example.test",
    token: "fictional-component-token",
  } as Credentials,
}));
vi.mock("react-native", () => ({
  Animated: { ScrollView: "ScrollView" },
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
  Alert: { alert: vi.fn() },
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect", Circle: "Circle" }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
  usePreventRemove: vi.fn(),
}));
vi.mock("../src/books/export-publication", () => ({ exportPublication: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "new-fictional-block" }));
vi.mock("../src/state/AppContext", () => { const useApp = () => ({ credentials: mocks.credentials, online: mocks.online }); return { useApp, useAppData: useApp, useAppActions: useApp, useSyncStatus: useApp }; });
vi.mock("../src/reading/native", () => ({
  resolveReadingScope: mocks.scope,
  invalidateReadingCredentials: mocks.invalidate,
  nativeReadingStore: { list: mocks.downloads, get: mocks.download },
  readingFileUri: (key: string, media: { id: string }) => `file:///downloads/${key}/${media.id}.jpg`,
  readingDownloads: { subscribe: (fn: (key?: string) => void) => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn); } },
}));
vi.mock("../src/api/client", async original => ({
  ...await original<object>(),
  fetchBook: mocks.get,
  fetchBooks: mocks.list,
  mutateBook: mocks.mutate,
  fetchBookMaterials: mocks.materials,
  requestMobileJson: mocks.create,
  fetchBookRenders: async () => [],
}));
const { BooksScreen, BookDetailScreen } =
  await import("../src/screens/BookScreens");
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
beforeEach(() => { mocks.online = true; mocks.credentials = { serverUrl: "https://fictional.example.test", token: "fictional-component-token" }; });
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
      (n.props.accessibilityLabel === label || n.findAll((c) => String(c.type) === "Text" && c.props.children === label)
        .length > 0),
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
it("creates a work from selected memories without a title or template form", async () => {
  mocks.list.mockResolvedValue({entries:[],nextCursor:null,canWrite:true});
  mocks.materials.mockResolvedValue({entries:[{id:"memory",kind:"memory",title:"窗边阅读"}],nextCursor:null});
  mocks.create.mockResolvedValue({id:"new-book",kind:"book"});
  await act(async () => { tree = create(createElement(BooksScreen,{navigation:{navigate:mocks.navigate}} as unknown as Parameters<typeof BooksScreen>[0])); });
  expect(tree!.root.findAllByType("TextInput" as never)).toHaveLength(0);
  await press("新建成长册");
  await press("窗边阅读");
  await press("生成预览");
  expect(mocks.create).toHaveBeenCalledWith(mocks.credentials,"/api/works",expect.objectContaining({method:"POST",body:JSON.stringify({kind:"book",audience:"family",template:"growth",selection:[{id:"memory",kind:"memory"}]})}));
  expect(mocks.navigate).toHaveBeenCalledWith("BookDetail",{id:"new-book"});
});
it("reads consecutive chapters without opening the editor or making a mutation", async () => {
  const book = detail();
  book.chapters.push({ id: "chapter-two", title: "第二章" });
  book.blocks.push({ ...book.blocks[0]!, id: "third", chapterId: "chapter-two", text: "下一章的故事" });
  mocks.get.mockResolvedValue(book);
  await act(async () => { tree = create(createElement(BookDetailScreen, { navigation: { navigate: mocks.navigate }, route: { params: { id: "book" } } } as unknown as Parameters<typeof BookDetailScreen>[0])); });
  expect(tree!.root.findAllByType("TextInput" as never)).toHaveLength(0);
  expect(JSON.stringify(tree!.toJSON())).toContain("虚构内容 first");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("下一章的故事");
  await press("下一章");
  expect(JSON.stringify(tree!.toJSON())).toContain("下一章的故事");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("虚构内容 first");
  await press("上一章");
  expect(JSON.stringify(tree!.toJSON())).toContain("虚构内容 first");
  expect(mocks.mutate).not.toHaveBeenCalled();
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
  await press("调整这本成长册");
  await press("选择此内容");
  await field("正文", "我保留的手工文字");
  await press("内容下移");
  await press("作品管理");
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
  await press("添加记忆或相册");
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
  await press("调整这本成长册");
  await press("整本设置");
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

function prepareDownloadedBook() {
  mocks.online = false;
  const scope = { key: "a".repeat(64), serverUrl: mocks.credentials.serverUrl, familyId: "family", userId: "reader" };
  const entry: DownloadEntry = {
    key: `${scope.key}/book-saved`, scope: scope.key, kind: "book", id: "saved", title: "下载好的成长册", state: "ready",
    reservedBytes: 1, storedBytes: 1, updatedAt: 1, error: null, completed: ["cover"], progress: { chapter: 0, page: 0, media: {} },
    manifest: { schemaVersion: 1, kind: "book", id: "saved", title: "下载好的成长册", subtitle: "第一周", revision: 1,
      digest: "b".repeat(64), userId: scope.userId, familyId: scope.familyId, audience: "family", timezone: "UTC", bytes: 1,
      chapters: [{ id: "cover", title: "封面", blocks: [{ id: "cover", kind: "image", text: "", caption: "", images: ["cover"], layout: defaultBookLayout(), sourceLabels: [], dateLabel: "", author: null, memoryEventId: null }] }],
      media: [{ id: "cover", filename: "cover.jpg", type: "image", mimeType: "image/jpeg", bytes: 1, sha256: "a".repeat(64), width: 100, height: 100, durationMs: null, author: null, dateLabel: "", memoryEventId: null, transcript: null }] },
  };
  mocks.scope.mockResolvedValue({ scope, online: false });
  mocks.downloads.mockResolvedValue([entry]);
  mocks.download.mockResolvedValue(entry);
  return entry;
}

it("opens a downloaded book from its original shelf cover without going through settings", async () => {
  const entry = prepareDownloadedBook();
  await act(async () => { tree = create(createElement(BooksScreen, { navigation: { navigate: mocks.navigate } } as never)); });
  const cover = tree!.root.findAllByType("Image" as never)[0]!;
  expect(cover.props.source.uri).toBe(`file:///downloads/${entry.key}/cover.jpg`);
  expect(cover.props.source.headers).toBeUndefined();
  await press(entry.title);
  expect(mocks.navigate).toHaveBeenCalledWith("OfflineReading", { key: entry.key });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("removes an offline cover as soon as its reading copy is cleared or revoked", async () => {
  const entry = prepareDownloadedBook();
  await act(async () => { tree = create(createElement(BooksScreen, { navigation: { navigate: mocks.navigate } } as never)); });
  expect(JSON.stringify(tree!.toJSON())).toContain(entry.title);
  await act(async () => { mocks.listeners.forEach(listener => listener(entry.key)); });
  expect(JSON.stringify(tree!.toJSON())).not.toContain(entry.title);
  expect(tree!.root.findAllByType("Image" as never)).toHaveLength(0);
  expect(mocks.list).not.toHaveBeenCalled();
});

it("does not restore a revoked cover when an older storage read finishes late", async () => {
  const entry = prepareDownloadedBook();
  let finish!: (value: DownloadEntry) => void;
  mocks.download.mockReturnValue(new Promise<DownloadEntry>(resolve => { finish = resolve; }));
  await act(async () => { tree = create(createElement(BooksScreen, { navigation: { navigate: mocks.navigate } } as never)); });
  await act(async () => { mocks.listeners.forEach(listener => listener(entry.key)); });
  await act(async () => { finish(entry); });
  expect(JSON.stringify(tree!.toJSON())).not.toContain(entry.title);
  expect(tree!.root.findAllByType("Image" as never)).toHaveLength(0);
});

it.each([401, 403, 404])("removes downloaded covers when reconnecting receives HTTP %i", async status => {
  const entry = prepareDownloadedBook();
  await act(async () => { tree = create(createElement(BooksScreen, { navigation: { navigate: mocks.navigate } } as never)); });
  expect(JSON.stringify(tree!.toJSON())).toContain(entry.title);
  mocks.online = true;
  mocks.list.mockRejectedValue(new ApiError("已无权阅读", status));
  await act(async () => { tree!.update(createElement(BooksScreen, { navigation: { navigate: mocks.navigate } } as never)); });
  expect(JSON.stringify(tree!.toJSON())).not.toContain(entry.title);
  expect(JSON.stringify(tree!.toJSON())).toContain("已无权阅读");
  expect(mocks.download).toHaveBeenCalledTimes(1);
});

it.each([{ token: "other-reader-token" }, { instanceId: "replacement-server" }])("hides the old book immediately when the account or instance changes: %j", async change => {
  const entry = prepareDownloadedBook();
  await act(async () => { tree = create(createElement(BooksScreen, { navigation: { navigate: mocks.navigate } } as never)); });
  expect(JSON.stringify(tree!.toJSON())).toContain(entry.title);
  mocks.credentials = { ...mocks.credentials, ...change };
  mocks.scope.mockImplementation(() => new Promise(() => {}));
  await act(async () => { tree!.update(createElement(BooksScreen, { navigation: { navigate: mocks.navigate } } as never)); });
  expect(JSON.stringify(tree!.toJSON())).not.toContain(entry.title);
  expect(tree!.root.findAllByType("Image" as never)).toHaveLength(0);
});
