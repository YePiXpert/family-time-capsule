import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Credentials } from "../src/types";
import type { ReadingManifest } from "../src/reading/types";
import { ReadingError } from "../src/reading/engine";

const m = vi.hoisted(() => ({
  scope: vi.fn(), list: vi.fn(), get: vi.fn(), manifest: vi.fn(), revalidate: vi.fn(), progress: vi.fn(), queue: vi.fn(), resume: vi.fn(), goBack: vi.fn(),
  credentials: null as Credentials | null, userId: "user" as string | null, familyId: "family" as string | null, online: true,
  appListeners: new Set<(state: string) => void>(), removed: new Set<(key?: string) => void>(), prevent: false,
  preventHandler: null as (() => void) | null, mounts: 0, activeReaders: 0,
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (value: unknown) => value },
  AppState: { currentState: "active", addEventListener: (_type: string, listener: (state: string) => void) => { m.appListeners.add(listener); return { remove: () => m.appListeners.delete(listener) }; } },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("@react-navigation/native", () => ({ usePreventRemove: (prevent: boolean, callback: () => void) => { m.prevent = prevent; m.preventHandler = callback; } }));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "JournalIcon" }));
vi.mock("../src/components/GlassSheet", () => ({ GlassSheet: ({ visible, children }: { visible: boolean; children: unknown }) => visible ? createElement("GlassSheet", {}, children as never) : null }));
vi.mock("../src/state/AppContext", () => ({ useAppData: () => ({ credentials: m.credentials, userId: m.userId, family: m.familyId ? { id: m.familyId } : null, online: m.online }) }));
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: (props: Record<string, unknown>) => {
  useEffect(() => { m.mounts++; m.activeReaders++; return () => { m.activeReaders--; }; }, []);
  return createElement("NativeMediaReader", props);
} }));
vi.mock("../src/reading/native", () => ({
  nativeReadingStore: { get: m.get, list: m.list }, resolveReadingScope: m.scope,
  nativeReadingTransport: () => ({ manifest: m.manifest }),
  readingDownloads: { revalidate: m.revalidate, saveProgress: m.progress, queue: m.queue, resume: m.resume,
    subscribe: (listener: (key?: string) => void) => { m.removed.add(listener); return () => m.removed.delete(listener); } },
  readingFileUri: (key: string, media: { id: string }) => `file:///reader-downloads/${key}/${media.id}`,
}));
const { FamilyViewingScreen } = await import("../src/screens/FamilyViewingScreen");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const credentials = { serverUrl: "https://fixture.invalid", instanceId: "instance", token: "fictional-token" };
const scope = { key: "a".repeat(64), serverUrl: credentials.serverUrl, userId: "user", familyId: "family" };
const key = `${scope.key}/collection-album`;
const navigation = { goBack: m.goBack };
function manifest(): ReadingManifest {
  return {
    schemaVersion: 1, kind: "collection", id: "album", revision: 1, digest: "b".repeat(64), userId: "user", familyId: "family", audience: "personal",
    title: "家庭相册", subtitle: "", timezone: "Asia/Shanghai", bytes: 30,
    media: ["image", "video", "audio", "document"].map((type, index) => ({
      id: type, type, filename: `${type}-original`, mimeType: type === "image" ? "image/jpeg" : type === "video" ? "video/mp4" : type === "audio" ? "audio/wav" : "application/pdf",
      bytes: 2, sha256: String(index).repeat(64), width: null, height: null, durationMs: type === "video" ? 60_000 : null, author: null,
      dateLabel: "2026年9月12日", memoryEventId: "memory", transcript: null,
    })),
    chapters: [{ id: "chapter", title: "一起长大", blocks: [{
      id: "block", kind: "text", text: "第一次说你好", caption: "我写的图说", images: ["image"], sourceLabels: ["真实记忆"], dateLabel: "2026年9月12日",
      memoryEventId: "memory", author: null, layout: { fit: "contain", breakBefore: false, focus: [] },
    }] }],
  };
}
function entry() { return { key, scope: scope.key, kind: "collection", id: "album", state: "ready", manifest: manifest(), progress: { chapter: 0, page: 0, media: { video: 14 } }, completed: ["image", "video", "audio", "document"] }; }
let tree: ReactTestRenderer | undefined;
let route: { params: { collectionId: string; downloadKey?: string } };
function reader() { return tree!.root.findByType("NativeMediaReader" as never); }
function readers() { return tree!.root.findAllByType("NativeMediaReader" as never); }
function text() { return JSON.stringify(tree!.toJSON()); }
async function render(download = false) {
  route = { params: { collectionId: "album", ...(download ? { downloadKey: key } : {}) } };
  await act(async () => { tree = create(createElement(FamilyViewingScreen, { route, navigation } as never)); });
}
async function rerender() { await act(async () => tree!.update(createElement(FamilyViewingScreen, { route, navigation } as never))); }
async function press(label: string, long = false) {
  const button = tree!.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === label)[0];
  expect(button, label).toBeTruthy(); await act(async () => long ? button!.props.onLongPress() : button!.props.onPress());
}
beforeEach(() => {
  vi.useFakeTimers(); m.credentials = credentials; m.userId = "user"; m.familyId = "family"; m.online = true; m.mounts = 0;
  m.scope.mockResolvedValue({ scope, online: true }); m.list.mockResolvedValue([]); m.manifest.mockResolvedValue(manifest());
  m.get.mockResolvedValue(entry()); m.revalidate.mockResolvedValue("online"); m.progress.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (tree) await act(() => tree!.unmount()); tree = undefined;
  expect(m.activeReaders).toBe(0); expect(m.appListeners.size).toBe(0); expect(m.removed.size).toBe(0);
  vi.clearAllMocks(); vi.useRealTimers();
});

it("limits viewing to the authorized album manifest and presents no source-editing or download actions", async () => {
  await render();
  expect(m.manifest).toHaveBeenCalledWith("collection", "album"); expect(reader().props.viewingOnly).toBe(true);
  expect(reader().props.assets.map((asset: { type: string }) => asset.type)).toEqual(["text", "image", "video", "audio"]);
  expect(reader().props.assets[0].readingText).toContain("我写的图说");
  expect(reader().props.credentials).toBe(credentials);
  for (const action of ["导出", "上传", "设置", "生成兼容", "删除", "编辑"]) expect(text()).not.toContain(action);
  expect(m.queue).not.toHaveBeenCalled(); expect(m.resume).not.toHaveBeenCalled();
});

it("requires the owner gesture and explicit confirmation before allowing stack removal", async () => {
  await render(); expect(m.prevent).toBe(true);
  await act(() => m.preventHandler?.()); expect(m.goBack).not.toHaveBeenCalled();
  const exit = tree!.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === "长按退出观看")[0]!;
  expect(exit.props.onPress).toBeUndefined(); expect(exit.props.delayLongPress).toBeGreaterThanOrEqual(1000);
  await press("长按退出观看", true); expect(text()).toContain("手机持有人确认"); expect(m.goBack).not.toHaveBeenCalled();
  await press("继续观看"); expect(m.prevent).toBe(true);
  await press("长按退出观看", true);
  m.goBack.mockImplementation(() => expect(m.prevent).toBe(false));
  await press("确认退出观看"); expect(m.goBack).toHaveBeenCalledOnce();
});

it("opens an existing verified download offline and saves only local viewing progress", async () => {
  m.online = false; m.scope.mockResolvedValue({ scope, online: false });
  await render(true); expect(m.revalidate).not.toHaveBeenCalled(); expect(m.manifest).not.toHaveBeenCalled();
  expect(reader().props.credentials).toBeNull();
  const video = reader().props.assets.find((asset: { id: string }) => asset.id === "video");
  expect(video.localUri).toContain(key); expect(video.initialSeconds).toBe(14);
  await act(async () => reader().props.onPosition("video", 23));
  expect(m.progress).toHaveBeenCalledWith(key, { chapter: 0, page: 0, media: { video: 23 } });
  expect(m.queue).not.toHaveBeenCalled(); expect(m.resume).not.toHaveBeenCalled();
});

it("revalidates a selected offline album online before rendering any cached media", async () => {
  let finish!: (value: string) => void;
  m.revalidate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(true); expect(readers()).toHaveLength(0);
  await act(async () => finish("online")); expect(readers()).toHaveLength(1);
  expect(m.revalidate).toHaveBeenCalledWith(scope, key, expect.anything());
});

it.each([401, 403, 404, 409])("withdraws an opened album when refresh returns %s", async (status) => {
  await render(); m.manifest.mockRejectedValue(new ReadingError("资料已不可读", status));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(readers()).toHaveLength(0); expect(text()).toContain("资料已不可读");
  m.manifest.mockResolvedValue(manifest()); await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(readers()).toHaveLength(0);
});

it.each(["account", "family", "connection", "logout"])("blocks a changed identity immediately without waiting for another server response (%s)", async (change) => {
  await render();
  if (change === "account") m.userId = "another-user";
  else if (change === "family") m.familyId = "another-family";
  else if (change === "connection") m.credentials = { ...credentials, token: "another-connection" };
  else m.credentials = null;
  m.scope.mockImplementation(() => new Promise(() => {}));
  await rerender(); expect(readers()).toHaveLength(0); expect(text()).toContain("账号或家庭已变化");
});

it("preserves the mounted viewer when the same account identity first hydrates", async () => {
  m.userId = null; await render();
  m.userId = "user"; await rerender(); expect(m.mounts).toBe(1); expect(readers()).toHaveLength(1);
});

it("rejects a cached album bound to a different scope", async () => {
  m.online = false; m.scope.mockResolvedValue({ scope, online: false }); m.get.mockResolvedValue({ ...entry(), scope: "c".repeat(64) });
  await render(true); expect(readers()).toHaveLength(0); expect(text()).toContain("下载已不可用");
});

it("stops background polling, keeps the current source stable and revalidates on foregrounding", async () => {
  await render(); const calls = m.manifest.mock.calls.length;
  await act(() => m.appListeners.forEach(listener => listener("background")));
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000); }); expect(m.manifest).toHaveBeenCalledTimes(calls);
  await act(async () => m.appListeners.forEach(listener => listener("active"))); expect(m.manifest).toHaveBeenCalledTimes(calls + 1); expect(m.mounts).toBe(1);
});

it("does not resurrect a downloaded album if cache withdrawal races an in-flight permission check", async () => {
  await render(true);
  let finish!: (value: string) => void;
  m.revalidate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  await act(() => m.removed.forEach(listener => listener(key))); expect(readers()).toHaveLength(0);
  await act(async () => finish("online"));
  expect(readers()).toHaveLength(0);
});
