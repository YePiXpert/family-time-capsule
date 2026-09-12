import { createElement, useEffect, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MediaDerivation } from "../src/media/types";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn(), rate: vi.fn(),
  fetch: vi.fn(), replace: vi.fn(), active: 0, created: 0, localExists: true,
  loadStatus: "readyToPlay" as "readyToPlay" | "error" | "loading",
  nativeMessage: "codec",
  appListeners: new Set<(state: string) => void>(),
  player: null as FakePlayer | null,
  beforeResolve: null as (() => void | Promise<void>) | null,
}));
type EventValue = { status?: string; isPlaying?: boolean; currentTime?: number; error?: { message: string }; source?: unknown };
class FakePlayer {
  status = "idle";
  duration = 60;
  currentTime = 0;
  playing = false;
  timeUpdateEventInterval = 0;
  listeners = new Map<string, Set<(value: EventValue) => void>>();
  addListener(event: string, listener: (value: EventValue) => void) {
    const set = this.listeners.get(event) || new Set();
    set.add(listener); this.listeners.set(event, set);
    return { remove: () => set.delete(listener) };
  }
  emit(event: string, value: EventValue) {
    if (value.status) this.status = value.status;
    if (value.currentTime !== undefined) this.currentTime = value.currentTime;
    for (const listener of this.listeners.get(event) || []) listener(value);
  }
  async replaceAsync(source: unknown) {
    mocks.replace(source);
    this.status = "loading";
    this.currentTime = 0;
    this.emit("statusChange", { status: "loading" });
    await Promise.resolve();
    this.emit("sourceChange", { source });
    this.emit("statusChange", { status: mocks.loadStatus, error: mocks.loadStatus === "error" ? { message: mocks.nativeMessage } : undefined });
    await mocks.beforeResolve?.();
  }
  play() { mocks.play(); this.playing = true; this.emit("playingChange", { isPlaying: true }); }
  seekBy(seconds: number) { this.currentTime += seconds; }
  pause() { mocks.pause(); this.playing = false; this.emit("playingChange", { isPlaying: false }); }
}
vi.mock("react-native", () => ({
  AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isReduceMotionEnabled: async () => true, isReduceTransparencyEnabled: async () => true },
  AppState: { currentState: "active", addEventListener: (_: string, listener: (state: string) => void) => {
    mocks.appListeners.add(listener); return { remove: () => mocks.appListeners.delete(listener) };
  } },
  ActivityIndicator: "ActivityIndicator", Image: "Image", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
  useWindowDimensions: () => ({ width: 375, height: 800 }), StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("expo-file-system", () => ({ File: class { get exists() { return mocks.localExists; } } }));
vi.mock("expo-video", () => ({ VideoView: "VideoView", useVideoPlayer: (source: unknown, setup: (player: FakePlayer) => void) => {
  const [player] = useState(() => { expect(source).toBeNull(); mocks.created++; const value = new FakePlayer(); setup(value); mocks.player = value; return value; });
  useEffect(() => { mocks.active++; return () => { mocks.active--; }; }, []);
  return player;
} }));
vi.mock("expo-audio", () => ({ useAudioPlayer: () => {
  useEffect(() => { mocks.active++; return () => { mocks.active--; }; }, []);
  return { play: mocks.play, pause: mocks.pause, seekTo: mocks.seek, setPlaybackRate: mocks.rate };
}, useAudioPlayerStatus: () => ({ duration: 60, currentTime: 12, isLoaded: true, playing: false, isBuffering: false, didJustFinish: false, error: null }) }));
vi.mock("../src/media/export-original", () => ({ exportOriginalCopy: vi.fn() }));
vi.mock("../src/api/client", () => ({ fetchMediaDerivations: mocks.get }));
const { NativeMediaReader } = await import("../src/media/NativeMediaReader");
const { NativeVideoPlayer } = await import("../src/media/NativeVideoPlayer");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const credentials = { serverUrl: "https://fictional.example.test", token: "fictional-test-token" };
const video = { id: "mov", type: "video", filename: "小美.mov", mimeType: "video/quicktime" };
function job(kind: MediaDerivation["kind"], status: MediaDerivation["status"], outputAssetId: string | null = null): MediaDerivation {
  return { kind, status, outputAssetId, errorCode: status === "failed" ? "codec_unavailable" : null };
}
beforeEach(() => {
  mocks.get.mockResolvedValue({ jobs: [], transcript: null });
  mocks.fetch.mockImplementation(async () => new Response("ab", { status: 206, headers: { "Content-Range": "bytes 0-1/1000", "Content-Type": "video/quicktime" } }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  expect(mocks.active).toBe(0);
  expect(mocks.appListeners.size).toBe(0);
  mocks.loadStatus = "readyToPlay"; mocks.nativeMessage = "codec"; mocks.localExists = true; mocks.created = 0; mocks.player = null; mocks.beforeResolve = null;
  vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
async function press(title: string) {
  const button = tree!.root.findAll(n => String(n.type) === "Pressable" && (n.props.accessibilityLabel === title || n.findAll(c => String(c.type) === "Text" && c.props.children === title).length > 0))[0]!;
  expect(button, title).toBeTruthy();
  await act(async () => button.props.onPress());
}
function text() { return JSON.stringify(tree!.toJSON()); }
function nativeView() { return tree!.root.findByType("VideoView" as never); }
async function frame() { await act(() => nativeView().props.onFirstFrameRender()); }
async function appState(state: string) { await act(() => { for (const listener of mocks.appListeners) listener(state); }); }
async function mountVideo(local = false) {
  await act(async () => { tree = create(createElement(NativeMediaReader, { credentials: local ? null : credentials, assets: [{ ...video, ...(local ? { localUri: "file:///private/original.mov" } : {}) }] })); });
  expect(mocks.active).toBe(0);
  await press("打开阅读器：小美.mov");
}

it("creates only the active player, controls audio and releases it on image navigation and closing", async () => {
  mocks.get.mockResolvedValue({ jobs: [], transcript: { text: "妈妈的原话", edited: false, segments: [{ startSeconds: 10, endSeconds: 15, text: "十秒处的原话" }] } });
  await act(async () => { tree = create(createElement(NativeMediaReader, { credentials, assets: [
    { id: "audio-one", type: "audio", filename: "妈妈的声音", mimeType: "audio/wav" },
    { id: "photo-one", type: "image", filename: "虚构合照", mimeType: "image/jpeg" },
    { id: "audio-two", type: "audio", filename: "爸爸的声音", mimeType: "audio/wav" },
  ] })); });
  expect(mocks.active).toBe(0); await press("打开阅读器：妈妈的声音"); expect(mocks.active).toBe(1); expect(mocks.play).not.toHaveBeenCalled();
  await press("播放声音"); expect(mocks.play).toHaveBeenCalledOnce(); await press("播放速度 1×"); expect(mocks.rate).toHaveBeenCalledWith(1.25);
  await press("10.0 秒 · 十秒处的原话"); expect(mocks.seek).toHaveBeenCalledWith(10);
  await press("下一份"); expect(mocks.active).toBe(0); await press("放大");
  const photo = tree!.root.findAll(n => String(n.type) === "Image" && n.props.accessibilityLabel === "虚构合照").at(-1)!;
  expect(photo.props.style.width).toBeGreaterThan(375);
  await press("下一份"); expect(mocks.active).toBe(1); await press("关闭阅读器"); expect(mocks.active).toBe(0);
});

it.each([401, 403, 404])("distinguishes access failure %s from networking, while keeping local audio readable", async (status) => {
  mocks.get.mockRejectedValue(Object.assign(new Error("revoked"), { status }));
  await act(async () => { tree = create(createElement(NativeMediaReader, { credentials, assets: [
    { id: "remote", type: "audio", filename: "服务器声音", mimeType: "audio/wav" },
    { id: "local", type: "audio", filename: "本机声音", mimeType: "audio/wav", localUri: "file:///fictional-original.wav" },
  ] })); });
  await press("打开阅读器：服务器声音"); expect(text()).toContain(status === 401 ? "登录已过期" : "当前没有阅读权限"); expect(mocks.active).toBe(0);
  mocks.get.mockRejectedValue(Object.assign(new Error("offline"), { status: 0 })); await press("重新加载"); expect(text()).toContain("检查网络后重试");
  await press("下一份"); expect(mocks.active).toBe(1); expect(text()).not.toContain("带真实时间段");
});

it("restores local voice progress and transcript without remote requests or autoplay", async () => {
  mocks.seek.mockResolvedValue(undefined); const onPosition = vi.fn();
  await act(async () => { tree = create(createElement(NativeMediaReader, { credentials: null, onPosition, assets: [{ id: "cached", type: "audio", filename: "已下载虚构声音", mimeType: "audio/wav", localUri: "file:///fictional.wav", initialSeconds: 8, localTranscript: { text: "有时间戳的原话", edited: false, segments: [{ startSeconds: 3, endSeconds: 5, text: "真实三秒原话" }] } }] })); });
  await press("打开阅读器：已下载虚构声音"); expect(mocks.seek).toHaveBeenCalledWith(8); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.play).not.toHaveBeenCalled();
  await press("3.0 秒 · 真实三秒原话"); expect(mocks.seek).toHaveBeenCalledWith(3); await press("关闭阅读器"); expect(onPosition).toHaveBeenCalledWith("cached", 12);
});

it("clicking a video plays it, removes its cover only on first frame and keeps the viewport height stable", async () => {
  mocks.get.mockResolvedValue({ jobs: [job("preview", "succeeded", "cover")], transcript: null });
  await mountVideo();
  expect(mocks.created).toBe(1); expect(mocks.active).toBe(1); expect(mocks.play).toHaveBeenCalledOnce();
  const viewport = () => tree!.root.findAll(n => String(n.type) === "View" && n.props.testID === "media-video-viewport")[0]!.props.style;
  const original = viewport(); expect(original.height).toBe(340);
  expect(text()).toContain("视频封面"); expect(text()).not.toContain("视频画面已显示");
  await frame(); expect(text()).not.toContain("视频封面"); expect(text()).toContain("视频画面已显示"); expect(viewport()).toEqual(original);
  await press("暂停视频"); expect(mocks.player!.playing).toBe(false); await press("播放视频"); expect(mocks.player!.playing).toBe(true);
  await press("关闭阅读器"); expect(mocks.active).toBe(0);
});

it("prefers an existing compatible video before loading the original", async () => {
  mocks.get.mockResolvedValue({ jobs: [job("transcode", "succeeded", "compatible")], transcript: null });
  await mountVideo();
  expect(mocks.replace).toHaveBeenCalledOnce(); expect(mocks.replace.mock.calls[0]![0].uri).toContain("/compatible");
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(0);
});

it("requests one compatible version only after authenticated video range verification and switches in the same player", async () => {
  vi.useFakeTimers(); mocks.loadStatus = "error";
  let processing = false; let ready = false;
  mocks.get.mockImplementation(async (_auth, _asset, kind) => {
    if (kind === "transcode") processing = true;
    return { jobs: [job("preview", "succeeded", "cover"), ...(processing ? [job("transcode", ready ? "succeeded" : "queued", ready ? "compatible" : null)] : [])], transcript: null };
  });
  await mountVideo();
  expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("/mov"), expect.objectContaining({ headers: { Authorization: `Bearer ${credentials.token}`, Range: "bytes=0-1" } }));
  expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(1);
  expect(text()).toContain("正在准备兼容播放版"); expect(mocks.replace).toHaveBeenCalledOnce();
  ready = true; mocks.loadStatus = "readyToPlay";
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(mocks.replace.mock.calls.at(-1)![0].uri).toContain("/compatible"); expect(mocks.created).toBe(1); expect(mocks.play).toHaveBeenCalledOnce();
  await frame(); expect(text()).toContain("视频画面已显示"); expect(text()).not.toContain("正在准备兼容播放版");
});

it.each([401, 403, 404, 500])("does not transcode a remote video when its range request returns %s", async (status) => {
  mocks.loadStatus = "error";
  mocks.fetch.mockResolvedValue(new Response("unavailable", { status }));
  await mountVideo();
  expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(0);
  expect(text()).toContain(status === 401 ? "登录已过期" : status === 403 || status === 404 ? "当前没有阅读权限" : "分段数据");
});

it("does not transcode a network failure or a loading/first-frame timeout", async () => {
  vi.useFakeTimers(); mocks.loadStatus = "loading";
  await mountVideo();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(text()).toContain("视频加载超过 15 秒"); expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(0);
  mocks.loadStatus = "readyToPlay"; await press("重试视频");
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(text()).toContain("视频加载超过 15 秒"); expect(mocks.created).toBe(1);
  mocks.fetch.mockRejectedValue(new Error("offline")); mocks.loadStatus = "error"; await press("重试视频");
  expect(text()).toContain("检查网络后重试"); expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(0);
});

it("distinguishes a missing local file and unsupported local encoding without uploading", async () => {
  mocks.loadStatus = "error"; mocks.localExists = false;
  await mountVideo(true); expect(text()).toContain("本机视频文件已不在原位置");
  mocks.localExists = true; await press("重试视频"); expect(text()).toContain("原件已保存在本机"); expect(text()).toContain("已同步的原件");
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled(); expect(text()).toContain("导出原件副本");
});

it("shows the conversion failure reason and allows a manual retry without looping", async () => {
  vi.useFakeTimers(); let failed = true;
  mocks.get.mockImplementation(async (_auth, _id, kind) => {
    if (kind === "transcode") failed = false;
    return { jobs: [job("preview", "succeeded", "cover"), job("transcode", failed ? "failed" : "queued")], transcript: null };
  });
  await mountVideo(); expect(text()).toContain("服务器缺少视频转换工具");
  expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(0);
  await press("重试视频"); expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(1); expect(text()).toContain("正在准备兼容播放版");
});

it("preserves position and pause across compatible source replacement and ignores prop-only updates", async () => {
  const onPosition = vi.fn();
  const props = { source: { uri: "https://fictional.example.test/original" }, poster: null, localOriginal: false, retryToken: 0, initialSeconds: 8, onPosition, onUnsupported: vi.fn(), onRetry: vi.fn() };
  await act(async () => { tree = create(createElement(NativeVideoPlayer, props)); });
  expect(mocks.player!.currentTime).toBe(8); await frame();
  await act(() => mocks.player!.emit("timeUpdate", { currentTime: 17 }));
  await press("暂停视频");
  const player = mocks.player;
  await act(async () => tree!.update(createElement(NativeVideoPlayer, { ...props, source: { uri: "https://fictional.example.test/compatible" } })));
  expect(mocks.player).toBe(player); expect(mocks.created).toBe(1); expect(mocks.player!.currentTime).toBe(17); expect(mocks.player!.playing).toBe(false);
  expect(mocks.replace).toHaveBeenCalledTimes(2);
  await act(async () => tree!.update(createElement(NativeVideoPlayer, { ...props, source: { uri: "https://fictional.example.test/compatible" }, onPosition: seconds => onPosition(seconds) })));
  expect(mocks.replace).toHaveBeenCalledTimes(2); await press("播放视频"); expect(mocks.player!.playing).toBe(true);
});

it("pauses in background, aborts polling and releases without applying late requests", async () => {
  vi.useFakeTimers();
  mocks.get.mockResolvedValue({ jobs: [job("preview", "running")], transcript: null });
  await mountVideo(); await frame(); const calls = mocks.get.mock.calls.length;
  await appState("background"); expect(mocks.player!.playing).toBe(false);
  expect(mocks.get.mock.calls.at(-1)![3].aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(mocks.get).toHaveBeenCalledTimes(calls);
  await appState("active"); expect(mocks.get.mock.calls.length).toBeGreaterThan(calls); expect(mocks.player!.playing).toBe(false);
  await press("播放视频"); expect(mocks.player!.playing).toBe(true); await press("关闭阅读器");
  const afterClose = mocks.get.mock.calls.length; await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(mocks.get).toHaveBeenCalledTimes(afterClose); expect(mocks.active).toBe(0);
});

it("uses a confirmed local-to-remote mapping for existing MPEG compatibility without giving up the local original", async () => {
  mocks.get.mockResolvedValue({ jobs: [job("preview", "succeeded", "cover"), job("transcode", "succeeded", "compatible")], transcript: null });
  await act(async () => { tree = create(createElement(NativeMediaReader, { credentials, assets: [{ ...video, id: "local-capture", localUri: "file:///private/original.mpg", remoteAssetId: "remote-original" }] })); });
  await press("打开阅读器：小美.mov");
  expect(mocks.get.mock.calls.every(args => args[1] === "remote-original")).toBe(true);
  expect(mocks.replace).toHaveBeenCalledOnce(); expect(mocks.replace.mock.calls[0]![0].uri).toContain("/compatible");
  const cover = tree!.root.findAll(n => String(n.type) === "Image" && n.props.accessibilityLabel === "视频封面")[0]!;
  expect(cover.props.source.uri).toContain("/cover"); expect(mocks.fetch).not.toHaveBeenCalled();
  expect(text()).toContain("导出原件副本");
});

it.each([null, 401, 0])("keeps a mapped local video available when remote credentials/network are unavailable (%s)", async (status) => {
  mocks.get.mockRejectedValue(Object.assign(new Error("unavailable"), { status }));
  await act(async () => { tree = create(createElement(NativeMediaReader, { credentials: status === null ? null : credentials, assets: [{ ...video, localUri: "file:///private/original.mov", remoteAssetId: "remote-original" }] })); });
  await press("打开阅读器：小美.mov");
  expect(mocks.replace.mock.calls.at(-1)![0].uri).toBe("file:///private/original.mov"); expect(mocks.play).toHaveBeenCalledOnce();
  await frame(); expect(text()).toContain("视频画面已显示"); expect(text()).not.toContain("登录已过期");
  expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(0);
});

it("checks the mapped original is readable before converting a synced local codec failure", async () => {
  mocks.loadStatus = "error";
  mocks.get.mockImplementation(async (_auth, _id, kind) => ({ jobs: kind === "transcode" ? [job("transcode", "queued")] : [], transcript: null }));
  await act(async () => { tree = create(createElement(NativeMediaReader, { credentials, assets: [{ ...video, localUri: "file:///private/original.mpg", remoteAssetId: "remote-original" }] })); });
  await press("打开阅读器：小美.mov");
  expect(mocks.fetch.mock.calls[0]![0]).toContain("/remote-original");
  expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(1);
});

it("accepts a real first frame delivered before the native replace promise settles", async () => {
  mocks.beforeResolve = () => nativeView().props.onFirstFrameRender();
  await mountVideo(true);
  expect(text()).toContain("视频画面已显示"); expect(text()).not.toContain("等待视频画面");
});

it("retries a stalled native load without waiting for its old promise and ignores its late completion", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  mocks.beforeResolve = () => pending;
  await mountVideo(true); expect(mocks.play).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); expect(text()).toContain("视频加载超过 15 秒");
  mocks.beforeResolve = null;
  await press("重试视频"); expect(mocks.replace).toHaveBeenCalledTimes(2); expect(mocks.play).toHaveBeenCalledOnce(); expect(mocks.created).toBe(1);
  await frame(); await act(async () => release()); expect(mocks.play).toHaveBeenCalledOnce(); expect(text()).toContain("视频画面已显示");
});

it("clears the native item and controls when the current source is withdrawn", async () => {
  const props = { source: { uri: "https://fictional.example.test/video" }, poster: null, localOriginal: false, retryToken: 0, onUnsupported: vi.fn(), onRetry: vi.fn() };
  await act(async () => { tree = create(createElement(NativeVideoPlayer, props)); }); await frame();
  expect(nativeView().props.nativeControls).toBe(true);
  await act(async () => tree!.update(createElement(NativeVideoPlayer, { ...props, source: null, externalError: "当前没有阅读权限" })));
  expect(mocks.replace).toHaveBeenLastCalledWith(null); expect(nativeView().props.nativeControls).toBe(false); expect(mocks.player!.playing).toBe(false);
  expect(text()).not.toContain("视频画面已显示"); expect(text()).toContain("当前没有阅读权限");
});

it("permits exactly one new automatic compatibility attempt after an explicit retry of a failed request", async () => {
  mocks.loadStatus = "error";
  mocks.get.mockImplementation(async (_auth, _id, kind) => {
    if (kind === "transcode") throw Object.assign(new Error("offline"), { status: 0 });
    return { jobs: [], transcript: null };
  });
  await mountVideo(); expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(1);
  await press("重试视频"); expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(2);
  expect(text()).toContain("检查网络后重试");
});

it("does not request conversion when the reader closes during the authenticated media probe", async () => {
  mocks.loadStatus = "error";
  let release!: (response: Response) => void;
  mocks.fetch.mockImplementation(() => new Promise<Response>(resolve => { release = resolve; }));
  await mountVideo();
  const signal: AbortSignal = mocks.fetch.mock.calls[0]![1].signal;
  await press("关闭阅读器"); expect(signal.aborted).toBe(true);
  await act(async () => release(new Response("ab", { status: 206, headers: { "Content-Range": "bytes 0-1/100", "Content-Type": "video/mp4" } })));
  expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(0);
});

it("keeps an early native network failure from being reclassified as a codec when replace completes", async () => {
  mocks.loadStatus = "error"; mocks.nativeMessage = "NSURLErrorDomain -1009";
  await mountVideo(); expect(text()).toContain("视频连接中断");
  expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(0);
});

it("counts the first-frame deadline from the tap, including the initial metadata lookup", async () => {
  vi.useFakeTimers();
  let release!: (data: unknown) => void;
  mocks.get.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await mountVideo();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  await act(async () => release({ jobs: [job("preview", "succeeded", "cover")], transcript: null }));
  expect(mocks.play).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(text()).toContain("视频加载超过 15 秒");
});

it("ignores a probe intentionally cancelled in background even if its rejection arrives after foregrounding", async () => {
  mocks.loadStatus = "error";
  let rejectProbe!: (reason: Error) => void;
  mocks.fetch.mockImplementation(() => new Promise((_resolve, reject) => { rejectProbe = reject; }));
  await mountVideo(); await appState("background"); await appState("active");
  await act(async () => rejectProbe(new Error("aborted")));
  expect(text()).not.toContain("无法连接服务器");
  mocks.loadStatus = "readyToPlay";
  await press("播放视频"); expect(mocks.replace).toHaveBeenCalledTimes(2); expect(mocks.player!.playing).toBe(true);
});

it("keeps active playback intent and position when a decoder fails after playback has started", async () => {
  let jobs: MediaDerivation[] = [];
  mocks.get.mockImplementation(async (_auth, _id, kind) => {
    if (kind === "transcode") jobs = [job("transcode", "succeeded", "compatible")];
    return { jobs, transcript: null };
  });
  await mountVideo(); await frame();
  await act(() => mocks.player!.emit("timeUpdate", { currentTime: 21 }));
  await act(async () => {
    // Native status properties can lag the event delivered over the bridge.
    for (const listener of mocks.player!.listeners.get("statusChange") || []) listener({ status: "error", error: { message: "decoder failed" } });
  });
  expect(mocks.get.mock.calls.filter(args => args[2] === "transcode")).toHaveLength(1);
  expect(mocks.created).toBe(1); expect(mocks.player!.currentTime).toBe(21); expect(mocks.player!.playing).toBe(true);
});

it("keeps the opened asset when synchronization reorders or reconciles the parent's asset array", async () => {
  const another = { id: "other", type: "video", filename: "另一段视频.mp4", mimeType: "video/mp4", localUri: "file:///private/other.mp4" };
  const original = { ...video, localUri: "file:///private/original.mov" };
  await act(async () => { tree = create(createElement(NativeMediaReader, { credentials: null, assets: [original, another] })); });
  await press("打开阅读器：小美.mov"); await frame();
  await act(async () => tree!.update(createElement(NativeMediaReader, { credentials: null, assets: [another, { ...original, id: "reconciled-server-id" }] })));
  expect(mocks.created).toBe(1); expect(mocks.replace).toHaveBeenCalledOnce(); expect(mocks.replace.mock.calls[0]![0].uri).toBe(original.localUri);
});

it("closes and releases a remote asset removed from the permitted list and does not reopen it on a later update", async () => {
  await mountVideo(); await frame();
  await act(async () => tree!.update(createElement(NativeMediaReader, { credentials, assets: [] })));
  expect(mocks.active).toBe(0); expect(tree!.root.findByType("Modal" as never).props.visible).toBe(false);
  await act(async () => tree!.update(createElement(NativeMediaReader, { credentials, assets: [video] })));
  expect(mocks.active).toBe(0); expect(tree!.root.findByType("Modal" as never).props.visible).toBe(false);
});

it("hides a previously rendered remote frame and preview immediately after authentication is revoked", async () => {
  mocks.get.mockResolvedValue({ jobs: [job("preview", "succeeded", "cover")], transcript: null });
  await mountVideo(); await frame(); expect(nativeView().props.style.opacity).toBe(1);
  mocks.get.mockRejectedValue(Object.assign(new Error("expired"), { status: 401 }));
  await press("重新加载");
  expect(text()).toContain("登录已过期"); expect(text()).not.toContain("视频封面"); expect(text()).not.toContain("视频画面已显示");
  expect(nativeView().props.style.opacity).toBe(0); expect(nativeView().props.nativeControls).toBe(false); expect(mocks.replace).toHaveBeenLastCalledWith(null);
});
