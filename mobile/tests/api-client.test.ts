import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createMobileContribution,
  normalizeServerUrl,
  parseMobileHome,
  parseMobileInboxPage,
  parseMobileMemory,
  parseMobileSearchPage,
  parseSyncPage,
  signIn,
  updateMobileContribution,
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
      personId: "person-1",
      canCapture: true,
      canReviewInbox: true,
      canCreateContributions: true,
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

  it("creates and edits text contributions through the existing mobile APIs", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ contributionId: "contribution-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "updated", memoryEventId: "memory-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const credentials = { serverUrl: "https://capsule.example.com", token: "native-session" };

    await expect(createMobileContribution(credentials, "memory-1", {
      authorPersonId: "person-1",
      text: "我的讲述",
      visibility: "family",
    })).resolves.toBe("contribution-1");
    await expect(updateMobileContribution(credentials, "contribution-1", "修改后的讲述")).resolves.toBe("memory-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://capsule.example.com/api/mobile/v1/memories/memory-1/contributions",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ authorPersonId: "person-1", text: "我的讲述", visibility: "family" }) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://capsule.example.com/api/mobile/v1/contributions/contribution-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ text: "修改后的讲述" }) }),
    );
  });

  it("validates a complete sync page before local mutation", () => {
    expect(parseSyncPage(validPage())).toEqual(validPage());
    for (const invalid of [
      { ...validPage(), apiVersion: 2 },
      { ...validPage(), family: undefined },
      { ...validPage(), viewer: { ...validPage().viewer, personId: undefined } },
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

  it("validates the product home, inbox, memory and search DTO boundaries", () => {
    const home = {
      family: { name: "小满家", timezone: "Asia/Shanghai" },
      child: { id: "child-1", displayName: "小满", currentAgeLabel: "2 岁", avatarPath: null },
      capabilities: { canCapture: true },
      inbox: { count: 1, previews: [{ id: "inbox-1", title: "待整理", status: "new", mediaPath: null }] },
      recentMemories: [{ id: "memory-1", title: "散步", occurredAt: "2026-09-01T00:00:00.000Z", ageLabel: "2 岁", coverPath: null }],
      onThisDay: [],
      story: null,
      capsule: null,
      prompt: { text: "小时候最喜欢什么？", recipientLabel: null, pendingCount: 0, isCreatedRequest: false },
      isFirstUse: false,
    };
    const inbox = {
      entries: [{
        id: "inbox-1", kind: "text", status: "new", title: "待整理", rawText: "正文",
        occurredAt: null, occurredAtWall: null, locationText: null, participantPersonIds: [],
        createdAt: "2026-09-01T00:00:00.000Z", assets: [],
      }],
      nextCursor: null,
    };
    const memory = {
      id: "memory-1", title: "散步", occurredAt: "2026-09-01T00:00:00.000Z",
      occurredAtWall: "2026-09-01T08:00", occurredAtPrecision: "exact", ageDays: 700,
      ageLabel: "1 岁 11 个月", locationText: null,
      childPersonId: "child-1", participantPersonIds: ["child-1"],
      participants: [{ id: "child-1", displayName: "小满", relationToChild: null, isChild: true }],
      sourceNotes: [{ id: "note-1", text: "正文" }],
      assets: [{ id: "audio-1", type: "audio", filename: "voice.m4a", mimeType: "audio/mp4", durationMs: 1000, mediaPath: "/api/media/audio-1", thumbnailPath: null }],
      contributions: [], updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const search = { items: [{ type: "memory", id: "memory-1", eventId: "memory-1", title: "散步", snippet: "散步" }], nextCursor: null };
    expect(parseMobileHome(home)).toEqual(home);
    expect(parseMobileInboxPage(inbox)).toEqual(inbox);
    expect(parseMobileMemory(memory)).toEqual(memory);
    expect(parseMobileSearchPage(search)).toEqual(search);
    expect(() => parseMobileHome({ ...home, inbox: { count: -1, previews: [] } })).toThrowError(ApiError);
    expect(() => parseMobileInboxPage({ ...inbox, entries: [{ ...inbox.entries[0], assets: [{ type: "executable" }] }] })).toThrowError(ApiError);
    expect(() => parseMobileMemory({ ...memory, contributions: [{ text: "missing policy fields" }] })).toThrowError(ApiError);
    expect(() => parseMobileSearchPage({ ...search, items: [{ ...search.items[0], type: "unknown" }] })).toThrowError(ApiError);
  });
});
