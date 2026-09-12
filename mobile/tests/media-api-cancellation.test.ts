import { afterEach, expect, it, vi } from "vitest";
import { fetchMediaDerivations } from "../src/api/client";
const credentials = { serverUrl: "https://fictional.example.test", token: "fictional-token" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("cancels an in-flight derivation request on reader cleanup while retaining its bounded API deadline", async () => {
  vi.useFakeTimers();
  let receivedSignal: AbortSignal | null = null;
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    receivedSignal = init.signal!;
    init.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })));
  const controller = new AbortController();
  const request = fetchMediaDerivations(credentials, "fictional-asset", undefined, controller.signal);
  const assertion = expect(request).rejects.toMatchObject({ status: 0 });
  controller.abort(); await assertion;
  expect(receivedSignal).toHaveProperty("aborted", true); expect(vi.getTimerCount()).toBe(0);
});

it("keeps the normal API timeout for callers without a cancellation signal", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  })));
  const assertion = expect(fetchMediaDerivations(credentials, "fictional-asset")).rejects.toMatchObject({ status: 0 });
  await vi.advanceTimersByTimeAsync(30_000); await assertion; expect(vi.getTimerCount()).toBe(0);
});
