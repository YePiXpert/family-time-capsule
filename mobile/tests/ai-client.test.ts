import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_SESSION_KEY,
  LEGACY_AI_SESSION_KEY,
} from "../src/local/brand";
import {
  AIError,
  api,
  changePassword,
  getToken,
  login,
  serviceStatus,
} from "../src/ai/client";
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
      JSON.stringify({ code: "BAD_INPUT", message: "用户名或密码不正确。" }),
      { status: 400 },
    );
    const e = await failure(() =>
      api("/login", { username: "妈妈", password: "password" }),
    );
    expect(e.code).toBe("BAD_INPUT");
    expect(e.message).toBe("用户名或密码不正确。");
  });
  it("passes valid JSON through and treats an empty body as an empty object", async () => {
    respondWith(JSON.stringify({ initialized: true }));
    await expect(serviceStatus()).resolves.toEqual({ initialized: true });
    respondWith("");
    await expect(api("/status")).resolves.toEqual({});
  });
});
describe("login only stores a usable device token", () => {
  it("rejects a too-short token without writing anything to the keychain", async () => {
    respondWith(JSON.stringify({ token: "short" }));
    const e = await failure(() => login("妈妈", "password123", "我的手机"));
    expect(e.code).toBe("INVALID_RESULT");
    expect(secure.store.has(AI_SESSION_KEY)).toBe(false);
    expect(secure.store.has(LEGACY_AI_SESSION_KEY)).toBe(false);
  });
  it("stores a valid token under the new session key", async () => {
    const token = "t".repeat(40);
    respondWith(JSON.stringify({ token }));
    await login("妈妈", "password123", "我的手机");
    expect(secure.store.get(AI_SESSION_KEY)).toBe(token);
  });
});
describe("changePassword sends the current password verbatim", () => {
  it("keeps surrounding whitespace on the current password", async () => {
    respondWith("{}");
    await changePassword("  secret  ", "new-password");
    expect(calls[0]!.method).toBe("PUT");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      current: "  secret  ",
      next: "new-password",
    });
  });
  it("omits the field entirely for an empty current password", async () => {
    respondWith("{}");
    await changePassword("", "new-password");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ next: "new-password" });
  });
});
