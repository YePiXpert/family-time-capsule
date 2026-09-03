import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  normalizeServerUrl,
  parseSyncPage,
  signIn,
} from "../src/api/client";
import type { SyncPage } from "../src/types";

function validPage(): SyncPage {
  return {
    apiVersion: 1,
    serverTime: "2026-09-03T20:00:00.000Z",
    viewer: {
      id: "user-1",
      name: "妈妈",
      role: "admin",
      canCapture: true,
      canEditEvents: true,
    },
    family: { id: "family-1", name: "小满家", timezone: "Asia/Shanghai" },
    people: [],
    events: [],
    nextCursor: null,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("native API client", () => {
  it("normalizes self-hosted HTTP(S) addresses only", () => {
    expect(normalizeServerUrl(" capsule.example.com/ ")).toBe(
      "https://capsule.example.com",
    );
    expect(normalizeServerUrl("http://192.168.1.8:3000/")).toBe(
      "http://192.168.1.8:3000",
    );
    expect(() => normalizeServerUrl("ftp://capsule.example.com")).toThrow(
      "HTTP 或 HTTPS",
    );
    expect(() => normalizeServerUrl("https://u:p@example.com")).toThrow(
      "不能包含账号",
    );
  });

  it("adds the same-origin header required by Better Auth", async () => {
    const fetch = vi.fn(async (_input: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("origin")).toBe(
        "https://capsule.example.com",
      );
      return new Response(JSON.stringify({ token: "native-session" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(
      signIn("https://capsule.example.com/base", "a@example.com", "password"),
    ).resolves.toEqual({
      serverUrl: "https://capsule.example.com/base",
      token: "native-session",
    });
  });

  it("validates a complete sync page before local mutation", () => {
    expect(parseSyncPage(validPage())).toEqual(validPage());
    for (const invalid of [
      { ...validPage(), apiVersion: 2 },
      { ...validPage(), family: undefined },
      { ...validPage(), serverTime: "not-a-date" },
      { ...validPage(), nextCursor: "" },
      {
        ...validPage(),
        events: Array.from({ length: 51 }, () => ({ id: "too-many" })),
      },
    ]) {
      expect(() => parseSyncPage(invalid)).toThrowError(ApiError);
    }
  });
});
