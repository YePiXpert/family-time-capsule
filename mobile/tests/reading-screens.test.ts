import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  alert: vi.fn(),
  scope: vi.fn(),
  manifest: vi.fn(),
  queue: vi.fn(),
  resume: vi.fn(),
  remove: vi.fn(),
  progress: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  listeners: new Set<(key?: string) => void>(),
  online: false,
  prepare: vi.fn(),
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
  Alert: { alert: mocks.alert },
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mocks.navigate }),
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
const credentials = {
  serverUrl: "https://fictional.example.test",
  token: "fictional-token",
};
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({ credentials, online: mocks.online }),
}));
vi.mock("../src/media/NativeMediaReader", () => ({
  NativeMediaReader: "NativeMediaReader",
}));
vi.mock("../src/reading/native", () => ({
  resolveReadingScope: mocks.scope,
  nativeReadingTransport: () => ({ manifest: mocks.manifest }),
  readingDownloads: {
    queue: mocks.queue,
    resume: mocks.resume,
    remove: mocks.remove,
    subscribe: (fn: (key?: string) => void) => {
      mocks.listeners.add(fn);
      return () => mocks.listeners.delete(fn);
    },
    saveProgress: mocks.progress,
    transferProgress: () => 0,
  },
  nativeReadingStore: { get: mocks.get, list: mocks.list },
  readingFileUri: (key: string, m: { id: string }) =>
    `file:///reader-downloads/${key}/${m.id}.jpg`,
  clearReadingScope: mocks.remove,
}));
const { ReadingDownloadButton } = await import("../src/reading/DownloadButton"),
  { OfflineReadingScreen, ReadingDownloadsScreen } =
    await import("../src/screens/ReadingScreens");
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  vi.clearAllMocks();
  mocks.listeners.clear();
});
async function press(title: string) {
  const node = tree!.root.findAll(
    (n) =>
      String(n.type) === "Pressable" &&
      n.findAll((c) => String(c.type) === "Text" && c.props.children === title)
        .length > 0,
  )[0];
  expect(node, title).toBeTruthy();
  await act(async () => node!.props.onPress());
}
const scope = {
    key: "a".repeat(64),
    serverUrl: credentials.serverUrl,
    userId: "user",
    familyId: "family",
  },
  key = `${scope.key}/book-fictional`;
const manifest = {
  schemaVersion: 1,
  kind: "book",
  id: "fictional",
  revision: 1,
  digest: "b".repeat(64),
  userId: "user",
  familyId: "family",
  audience: "family",
  title: "虚构离线成长册",
  subtitle: "手工说明保留",
  timezone: "Asia/Shanghai",
  bytes: 10000,
  media: [
    {
      id: "photo",
      type: "image",
      filename: "虚构照片.jpg",
      mimeType: "image/jpeg",
    },
    {
      id: "voice",
      type: "audio",
      filename: "虚构爸爸的声音",
      mimeType: "audio/wav",
      author: "爸爸",
      transcript: { text: "原话", edited: false, segments: [] },
    },
  ],
  chapters: [
    {
      id: "first",
      title: "第一周",
      blocks: Array.from({ length: 9 }, (_, i) => ({
        id: `block-${i}`,
        kind: "text",
        text: `虚构内容 ${i + 1}`,
        caption: "人工图说",
        images: ["photo"],
        sourceLabels: ["原始记忆"],
        memoryEventId: null,
        dateLabel: "2024年1月1日",
        author: null,
      })),
    },
  ],
};
const entry = {
  key,
  scope: scope.key,
  kind: "book",
  id: "fictional",
  title: manifest.title,
  state: "ready",
  reservedBytes: 10000,
  storedBytes: 9000,
  manifest,
  progress: { chapter: 0, page: 0, media: { voice: 12 } },
  completed: ["photo", "voice"],
};
it("shows actual capacity before queueing and preserves editing when prepare fails", async () => {
  mocks.scope.mockResolvedValue({ scope, online: true });
  mocks.manifest.mockResolvedValue(manifest);
  mocks.prepare.mockResolvedValue(false);
  mocks.queue.mockResolvedValue(entry);
  mocks.resume.mockResolvedValue(undefined);
  await act(async () => {
    tree = create(
      createElement(ReadingDownloadButton, {
        kind: "book",
        id: "fictional",
        prepare: mocks.prepare,
      }),
    );
  });
  await press("下载供离线阅读");
  expect(mocks.manifest).not.toHaveBeenCalled();
  expect(mocks.queue).not.toHaveBeenCalled();
  mocks.prepare.mockResolvedValue(true);
  await press("下载供离线阅读");
  expect(mocks.alert).toHaveBeenCalledWith(
    "下载供离线阅读",
    expect.stringContaining("1 张照片、1 段音频"),
    expect.any(Array),
  );
  expect(mocks.queue).not.toHaveBeenCalled();
  await act(async () => mocks.alert.mock.calls[0]![2][1].onPress());
  expect(mocks.queue).toHaveBeenCalledWith(scope, manifest, expect.anything());
  expect(mocks.navigate).toHaveBeenCalledWith("ReadingDownloads");
  expect(mocks.resume).toHaveBeenCalledWith(scope, key, expect.anything());
});
it("reads paged local images and voice positions offline, persists navigation and removes the open view on revocation", async () => {
  mocks.scope.mockResolvedValue({ scope, online: false });
  mocks.get.mockResolvedValue(entry);
  mocks.progress.mockResolvedValue(undefined);
  await act(async () => {
    tree = create(
      createElement(OfflineReadingScreen, {
        route: { params: { key } },
        navigation: { navigate: mocks.navigate },
      } as never),
    );
  });
  expect(JSON.stringify(tree!.toJSON())).toContain("虚构内容 1");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("虚构内容 9");
  expect(mocks.scope).toHaveBeenCalledWith(credentials, { offline: true });
  const players = tree!.root.findAll(
    (n) => String(n.type) === "NativeMediaReader",
  );
  expect(players[0]!.props.credentials).toBeNull();
  expect(players[0]!.props.assets[0].localUri).toContain("reader-downloads");
  const voice = players.at(-1)!;
  expect(voice.props.assets[0].initialSeconds).toBe(12);
  await act(async () => voice.props.onPosition("voice", 25));
  expect(mocks.progress).toHaveBeenLastCalledWith(
    key,
    expect.objectContaining({ media: { voice: 25 } }),
  );
  await press("下一组内容");
  expect(JSON.stringify(tree!.toJSON())).toContain("虚构内容 9");
  expect(mocks.progress).toHaveBeenLastCalledWith(
    key,
    expect.objectContaining({ page: 1, media: { voice: 25 } }),
  );
  await act(async () => mocks.listeners.forEach((fn) => fn(key)));
  expect(JSON.stringify(tree!.toJSON())).not.toContain("虚构内容 9");
  expect(JSON.stringify(tree!.toJSON())).toContain("旧缓存已撤下");
});
it("download list offers retry and confirms clearing only the current reading copy", async () => {
  mocks.scope.mockResolvedValue({ scope, online: false });
  mocks.list.mockResolvedValue([
    { ...entry, state: "failed", error: "下载校验失败" },
  ]);
  mocks.remove.mockResolvedValue(undefined);
  mocks.resume.mockResolvedValue(undefined);
  await act(async () => {
    tree = create(
      createElement(ReadingDownloadsScreen, {
        navigation: { navigate: mocks.navigate },
      } as never),
    );
  });
  expect(JSON.stringify(tree!.toJSON())).toContain("本机唯一原件和待同步素材");
  await press("重试下载");
  expect(mocks.resume).toHaveBeenCalledWith(scope, key, expect.anything());
  await press("清理这份下载");
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.alert.mock.calls[0]![1]).toContain(
    "本机原件和待同步素材不受影响",
  );
  await act(async () => mocks.alert.mock.calls[0]![2][1].onPress());
  expect(mocks.remove).toHaveBeenCalledWith(key, expect.anything());
});
