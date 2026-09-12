import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inspectPlaybackFailure } from "../src/media/playback-source";
vi.mock("expo-file-system", () => ({ File: class { exists = true; } }));
const source = { uri: "https://fictional.example.test/video", headers: { Authorization: "Bearer fictional-token" } };
const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });

it.each(["NSURLErrorDomain -1009", "connection reset", "network request failed", "request timed out"])("retains the native network error %s even if the two-byte probe succeeds", async (nativeMessage) => {
  fetchMock.mockResolvedValue(new Response("ab", { status: 206, headers: { "Content-Range": "bytes 0-1/1024", "Content-Type": "video/mp4" } }));
  expect(await inspectPlaybackFailure(source, false, nativeMessage, new AbortController().signal)).toMatchObject({ kind: "network" });
});

it.each([
  [200, "video/mp4", null],
  [206, "text/html", "bytes 0-1/1024"],
  [206, "video/mp4", null],
  [206, "video/mp4", "bytes 2-3/1024"],
] as const)("rejects an invalid media response (%s, %s, %s) as a service failure rather than a codec", async (status, type, range) => {
  fetchMock.mockResolvedValue(new Response("ab", { status, headers: { "Content-Type": type, ...(range ? { "Content-Range": range } : {}) } }));
  expect(await inspectPlaybackFailure(source, false, "unsupported media", new AbortController().signal)).toMatchObject({ kind: "server" });
});

it.each(["a", "abc"])("rejects a partial response whose body is not exactly two bytes (%s)", async (body) => {
  fetchMock.mockResolvedValue(new Response(body, { status: 206, headers: { "Content-Range": "bytes 0-1/1024", "Content-Type": "video/mp4" } }));
  expect(await inspectPlaybackFailure(source, false, "unsupported media", new AbortController().signal)).toMatchObject({ kind: "server" });
});

it("cancels an ignored Range response without reading a full video body", async () => {
  const cancel = vi.fn();
  fetchMock.mockResolvedValue(new Response(new ReadableStream({ pull() {}, cancel }), { status: 200, headers: { "Content-Type": "video/mp4" } }));
  expect(await inspectPlaybackFailure(source, false, "unsupported media", new AbortController().signal)).toMatchObject({ kind: "server" });
  expect(cancel).toHaveBeenCalledOnce();
});
