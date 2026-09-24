import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SERVICE_URL,
  AI_SESSION_KEY,
  LEGACY_AI_SESSION_KEY,
 AI_CONSENT_KEY, LEGACY_AI_CONSENT_KEY } from "../src/local/brand";
import {
  AIError,
  upload,
  api,
  getToken,
 hasConsent, giveConsent } from "../src/ai/client";

/** 内存版钥匙串：fails 里的键写入即失败，模拟系统钥匙串暂时不可写。 */
const secure = vi.hoisted(() => {
  const store = new Map<string, string>();
  const fails = new Set<string>();
  return {
    store,
    fails,
    module: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked",
      getItemAsync: async (key: string) => store.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        if (fails.has(key)) throw new Error("keychain unavailable");
        store.set(key, value);
      },
      deleteItemAsync: async (key: string) => {
        store.delete(key);
      },
    },
  };
});
vi.mock(
  "expo-secure-store",
  () => secure.module as unknown as typeof import("expo-secure-store"),
);
const realFetch = globalThis.fetch;
const calls: { url: string; method: string; body?: string }[] = [];
function respondWith(body: string, responseInit?: ResponseInit) {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(body, responseInit);
  }) as typeof fetch;
}
async function failure(fn: () => Promise<unknown>): Promise<AIError> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AIError) return e;
    throw new Error(`expected an AIError but got: ${String(e)}`);
  }
  throw new Error("expected the call to fail");
}
beforeEach(() => {
  secure.store.clear();
  secure.fails.clear();
  calls.length = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
describe("legacy session key carryover", () => {
  it("migrates a legacy credential to the new key and deletes the legacy key", async () => {
    secure.store.set(LEGACY_AI_SESSION_KEY, "legacy-token");
    await expect(getToken()).resolves.toBe("legacy-token");
    expect(secure.store.get(AI_SESSION_KEY)).toBe("legacy-token");
    expect(secure.store.has(LEGACY_AI_SESSION_KEY)).toBe(false);
  });
  it("still returns the legacy value when the new key cannot be written", async () => {
    secure.fails.add(AI_SESSION_KEY);
    secure.store.set(LEGACY_AI_SESSION_KEY, "legacy-token");
    await expect(getToken()).resolves.toBe("legacy-token");
  });
});
describe("api response parsing and error mapping", () => {
  it("aborts the underlying fetch when the caller cancels drafting", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    globalThis.fetch = vi.fn((_url, init) => {
      received = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        received?.addEventListener("abort", () => reject(new Error("aborted")));
        controller.abort();
      });
    });
    const error = await failure(() =>
      api("/ai/write", {}, "POST", controller.signal),
    );
    expect(received?.aborted).toBe(true);
    expect(error.code).toBe("CANCELED");
  });
  it("labels a non-JSON gateway error page as SERVER_ERROR, not NETWORK", async () => {
    respondWith("<html>502 Bad Gateway</html>", { status: 502 });
    const e = await failure(() => api("/status"));
    expect(e.code).toBe("SERVER_ERROR");
    expect(e.message).toBe("AI 服务暂时不可用。");
  });
  it("labels an unparsable 2xx body as INVALID_RESULT", async () => {
    respondWith("plain text that is not JSON", { status: 200 });
    const e = await failure(() => api("/status"));
    expect(e.code).toBe("INVALID_RESULT");
    expect(e.message).toBe("AI 服务返回了无法解析的内容。");
  });
  it("preserves code and message from a JSON error body", async () => {
    respondWith(
      JSON.stringify({ code: "BAD_INPUT", message: "请先写几句再让 AI 追问。" }),
      { status: 400 },
    );
    const e = await failure(() => api("/ai/write", { writingMode: "ask" }));
    expect(e.code).toBe("BAD_INPUT");
    expect(e.message).toBe("请先写几句再让 AI 追问。");
  });
  it("passes valid JSON through and treats an empty body as an empty object", async () => {
    respondWith(JSON.stringify({ initialized: true }));
    await expect(api("/status")).resolves.toEqual({ initialized: true });
    respondWith("");
    await expect(api("/status")).resolves.toEqual({});
  });
});
class FakeXHR {
  static last: FakeXHR;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body?: Uint8Array;
  status = 200;
  response: ArrayBuffer = new ArrayBuffer(0);
  responseType = "";
  timeout = 0;
  onload = () => {};
  onerror = () => {};
  ontimeout = () => {};
  onabort = () => {};
  constructor() { FakeXHR.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: Uint8Array) { this.body = body; }
  abort() { this.onabort(); }
  respond(text: string, status = 200) {
    this.status = status;
    this.response = new TextEncoder().encode(text).buffer;
    this.onload();
  }
}
describe("binary upload", () => {
  beforeEach(() => { vi.stubGlobal("XMLHttpRequest", FakeXHR); });
  afterEach(() => { vi.unstubAllGlobals(); });
  async function start(signal?: AbortSignal) {
    const body = new Uint8Array([1, 2, 3]);
    const promise = upload("/ai/transcribe", body, "audio/mp4", { "X-Audio-Seconds": "12" }, signal);
    // getToken can await both current and legacy secure-store entries.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    return { promise, body, xhr: FakeXHR.last };
  }
  it("sends the original bytes with authentication, length and audio headers", async () => {
    secure.store.set(AI_SESSION_KEY, "device-token");
    const { promise, body, xhr } = await start();
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(SERVICE_URL + "/ai/transcribe");
    expect(xhr.headers).toEqual({ Authorization: "Bearer device-token", "Content-Type": "audio/mp4", "Content-Length": "3", "X-Audio-Seconds": "12" });
    expect(xhr.body).toBe(body);
    expect(xhr.timeout).toBe(115000);
    expect(xhr.responseType).toBe("arraybuffer");
    xhr.respond('{"text":"她笑了"}');
    await expect(promise).resolves.toEqual({ text: "她笑了" });
  });
  it("preserves the server error code and Chinese message", async () => {
    const { promise, xhr } = await start();
    xhr.respond('{"code":"AUDIO_TOO_LONG","message":"这段太长了，录音已保存。"}', 413);
    await expect(promise).rejects.toMatchObject({ code: "AUDIO_TOO_LONG", message: "这段太长了，录音已保存。" });
  });
  it.each(["onerror", "ontimeout"] as const)("maps %s to NETWORK", async (event) => {
    const { promise, xhr } = await start(); xhr[event]();
    await expect(promise).rejects.toMatchObject({ code: "NETWORK", message: "现在连不上服务，请稍后再试。" });
  });
  it("aborts an in-flight request and ignores a late response", async () => {
    const controller = new AbortController();
    const { promise, xhr } = await start(controller.signal);
    controller.abort(); xhr.respond('{"text":"晚到"}');
    await expect(promise).rejects.toMatchObject({ code: "CANCELED" });
  });
  it("does not construct XHR for a pre-aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(upload("/ai/transcribe", new Uint8Array(), "audio/mp4", {}, controller.signal)).rejects.toMatchObject({ code: "CANCELED" });
  });
  it.each([[200, "INVALID_RESULT"], [502, "SERVER_ERROR"]])("maps non-JSON status %s correctly", async (status, code) => {
    const { promise, xhr } = await start(); xhr.respond("<html>bad gateway</html>", Number(status));
    await expect(promise).rejects.toMatchObject({ code });
  });
});
describe("v2 consent", () => {
  it("requires renewed consent for the old yes value", async () => {
    secure.store.set(AI_CONSENT_KEY, "yes");
    await expect(hasConsent()).resolves.toBe(false);
    await giveConsent();
    expect(secure.store.get(AI_CONSENT_KEY)).toBe("v2");
    await expect(hasConsent()).resolves.toBe(true);
  });
  it("also rejects a carried over legacy yes value", async () => {
    secure.store.set(LEGACY_AI_CONSENT_KEY, "yes");
    await expect(hasConsent()).resolves.toBe(false);
  });
});
