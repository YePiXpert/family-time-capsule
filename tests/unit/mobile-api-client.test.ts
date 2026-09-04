import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  normalizeServerUrl,
  parseSyncPage,
  signIn,
} from "../../mobile/src/api/client";
import type { SyncPage } from "../../mobile/src/types";

function validPage(): SyncPage {
  return {
    apiVersion: 1,
    serverTime: "2026-09-03T20:00:00.000Z",
    viewer: {
      id: "user-1",
      name: "妈妈",
      role: "admin",
      personId: "person-1",
      canCapture: true,
      canReviewInbox: true,
      canCreateContributions: true,
      canEditEvents: true,
    },
    family: { id: "family-1", name: "小满家", timezone: "Asia/Shanghai" },
    people: [
      {
        id: "child-1",
        displayName: "小满",
        relationToChild: null,
        isChild: true,
        birthDate: "2024-02-03",
        updatedAt: "2026-09-03T19:00:00.000Z",
      },
    ],
    events: [
      {
        id: "event-1",
        title: "公园里的下午",
        occurredAt: "2026-09-02T08:00:00.000Z",
        occurredAtPrecision: "exact",
        locationText: "公园",
        childPersonId: "child-1",
        ageDays: 942,
        ageLabel: "2 岁 6 个月",
        updatedAt: "2026-09-03T19:00:00.000Z",
        assetCount: 1,
        participantNames: ["妈妈"],
        captureIds: ["capture-1"],
        cover: {
          assetId: "asset-1",
          mediaAssetId: "thumb-1",
          type: "image",
          mimeType: "image/webp",
          path: "/api/media/thumb-1",
        },
      },
    ],
    nextCursor: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native mobile API client boundaries", () => {
  it("normalizes a self-hosted server without accepting other URL schemes", () => {
    expect(normalizeServerUrl(" capsule.example.com/ ")).toBe(
      "https://capsule.example.com",
    );
    expect(normalizeServerUrl("http://192.168.1.8:3000/")).toBe(
      "http://192.168.1.8:3000",
    );
    expect(() => normalizeServerUrl("ftp://capsule.example.com")).toThrow(
      "HTTP 或 HTTPS",
    );
    expect(() => normalizeServerUrl("https://user:pass@example.com")).toThrow(
      "不能包含账号",
    );
    expect(() => normalizeServerUrl("https://example.com/?token=secret")).toThrow(
      "不能包含账号",
    );
  });

  it("accepts the complete versioned sync DTO", () => {
    expect(parseSyncPage(validPage())).toEqual(validPage());
  });

  it("sends the self-hosted origin required by Better Auth native sign-in", async () => {
    const fetch = vi.fn(async (_input: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("origin")).toBe(
        "https://capsule.example.com",
      );
      return new Response(JSON.stringify({ token: "native-session-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(
      signIn(
        "https://capsule.example.com/archive",
        "person@example.com",
        "test-password",
      ),
    ).resolves.toEqual({
      serverUrl: "https://capsule.example.com/archive",
      token: "native-session-token",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong version", { ...validPage(), apiVersion: 2 }],
    ["missing family", { ...validPage(), family: undefined }],
    [
      "missing viewer person binding",
      {
        ...validPage(),
        viewer: { ...validPage().viewer, personId: undefined },
      },
    ],
    [
      "missing capture links",
      {
        ...validPage(),
        events: [{ ...validPage().events[0], captureIds: undefined }],
      },
    ],
    [
      "invalid cover path",
      {
        ...validPage(),
        events: [
          {
            ...validPage().events[0],
            cover: { ...validPage().events[0]!.cover!, path: "https://evil.test/x" },
          },
        ],
      },
    ],
    ["invalid timestamp", { ...validPage(), serverTime: "yesterday" }],
    ["invalid cursor", { ...validPage(), nextCursor: "" }],
    [
      "oversized page",
      { ...validPage(), events: Array.from({ length: 51 }, () => validPage().events[0]) },
    ],
  ])("rejects %s before it can mutate local SQLite", (_label, value) => {
    expect(() => parseSyncPage(value)).toThrowError(ApiError);
    try {
      parseSyncPage(value);
    } catch (error) {
      expect(error).toMatchObject({ name: "ApiError", status: 502 });
    }
  });
});
