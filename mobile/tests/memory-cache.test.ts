import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Credentials, MobileMemory, LocalTimelineEvent } from "../src/types";
const mocks = vi.hoisted(() => ({
  online: false, fetch: vi.fn(), events: [] as LocalTimelineEvent[],
  credentials: { serverUrl: "https://example.test", token: "A-session" } as Credentials | null,
  user: "A", family: "family",
}));
vi.mock("@react-native-community/datetimepicker", () => ({ default: "DateTimePicker", DateTimePickerAndroid: { open: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator", Image: "Image", Pressable: "Pressable", ScrollView: "ScrollView",
  Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: (x: unknown) => x, hairlineWidth: 1 },
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("../src/contributions/VoiceContribution", () => ({ NativeVoiceContribution: () => null }));
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: "NativeMediaReader" }));
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({
    credentials: mocks.credentials, events: mocks.events, family: { id: mocks.family, timezone: "UTC" },
    online: mocks.online, people: [], viewer: { id: mocks.user, role: "viewer", canCreateContributions: false },
  }),
}));
vi.mock("../src/api/client", async (original) => ({ ...await original<object>(), fetchMobileMemory: mocks.fetch }));
const store = await import("../src/storage/database");
const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");
const { MemoryScreen } = await import("../src/screens/MemoryScreen");
const { memoryCacheScope } = await import("../src/memories/cache-scope");
const { ApiError } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const at = "2026-09-05T00:00:00.000Z";
const memory: MobileMemory = {
  id: "event-1", title: "共同记忆", occurredAt: at, occurredAtWall: "2026-09-05T00:00", occurredAtPrecision: "exact",
  ageDays: null, ageLabel: null, locationText: null, childPersonId: "child", participantPersonIds: [],
  participants: [], sourceNotes: [], assets: [], updatedAt: at,
  contributions: [{ id: "private-A", authorPersonId: "person-A", authorName: "A", text: "A_PRIVATE_ONLY",
    visibility: "private", canEdit: true, audioPath: null }],
};
const scope = () => memoryCacheScope(mocks.credentials, mocks.user, mocks.family)!;
let tree: ReactTestRenderer | undefined;
const render = () => createElement(MemoryScreen, { route: { params: { id: memory.id } }, navigation: {} } as never);
async function open() { await act(async () => { tree = create(render()); }); }
const output = () => JSON.stringify(tree!.toJSON());
beforeEach(async () => {
  mocks.online = false;
  mocks.events = [];
  mocks.credentials = { serverUrl: "https://example.test", token: "A-session" };
  mocks.user = "A";
  mocks.family = "family";
  mocks.fetch.mockReset();
  await store.initializeLocalStore();
  await store.clearLocalArchive();
  await store.cacheMemoryDetail(scope(), memory);
});
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; });

it("reads the same session's offline cache without a network request", async () => {
  await open();
  expect(output()).toContain("A_PRIVATE_ONLY");
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it.each(["session", "user", "family", "server", "instance", "disconnect"])("hides cached and rendered private text when %s changes", async (field) => {
  await open();
  expect(output()).toContain("A_PRIVATE_ONLY");
  if (field === "session") mocks.credentials = { ...mocks.credentials!, token: "B-session" };
  if (field === "user") mocks.user = "B";
  if (field === "family") mocks.family = "another-family";
  if (field === "server") mocks.credentials = { ...mocks.credentials!, serverUrl: "https://other.test" };
  if (field === "instance") mocks.credentials = { ...mocks.credentials!, instanceId: "another-instance" };
  if (field === "disconnect") mocks.credentials = null;
  await act(async () => { tree!.update(render()); });
  expect(output()).not.toContain("A_PRIVATE_ONLY");
});
it.each([401, 403, 404])("removes the current cache after HTTP %i, including on subsequent offline opens", async (status) => {
  await open();
  mocks.online = true;
  mocks.fetch.mockRejectedValue(new ApiError("Access denied", status));
  await act(async () => { tree!.update(render()); });
  expect(output()).not.toContain("A_PRIVATE_ONLY");
  expect(await store.getCachedMemoryDetail(scope(), memory.id)).toBeNull();
  mocks.online = false;
  await act(async () => { tree!.update(render()); });
  expect(output()).not.toContain("A_PRIVATE_ONLY");
});
it.each([0, 503])("keeps the correct user's cache during a transient HTTP %i failure", async (status) => {
  mocks.online = true;
  mocks.fetch.mockRejectedValue(new ApiError("Unavailable", status));
  await open();
  expect(output()).toContain("A_PRIVATE_ONLY");
});
it("does not render or persist a response that arrives after switching accounts", async () => {
  const oldScope = scope();
  await store.removeCachedMemoryDetail(oldScope, memory.id);
  let resolve!: (value: MobileMemory) => void;
  mocks.online = true;
  mocks.fetch.mockReturnValue(new Promise<MobileMemory>((done) => { resolve = done; }));
  await open();
  mocks.credentials = { ...mocks.credentials!, token: "B-session" };
  mocks.user = "B";
  mocks.online = false;
  await act(async () => { tree!.update(render()); });
  await act(async () => { resolve(memory); });
  expect(output()).not.toContain("A_PRIVATE_ONLY");
  expect(await store.getCachedMemoryDetail(oldScope, memory.id)).toBeNull();
  expect(await store.getCachedMemoryDetail(scope(), memory.id)).toBeNull();
});
it("refreshes and caches an authorized response under the current scope", async () => {
  mocks.online = true;
  const next = { ...memory, title: "更新后的记忆", contributions: [] };
  mocks.fetch.mockResolvedValue(next);
  await open();
  expect(output()).toContain("更新后的记忆");
  expect(output()).not.toContain("A_PRIVATE_ONLY");
  expect(await store.getCachedMemoryDetail(scope(), memory.id)).toEqual(next);
});
it("drops unowned legacy detail caches while preserving local captures and pending uploads", async () => {
  await store.enqueueTextCapture("local-original", { text: "不可替代的本机原文" });
  const raw = getRawMockDatabase();
  raw.exec("DROP TABLE memory_detail; CREATE TABLE memory_detail(id TEXT PRIMARY KEY, detail_json TEXT, updated_at TEXT);");
  raw.prepare("INSERT INTO memory_detail VALUES (?, ?, ?)").run(memory.id, JSON.stringify(memory), at);
  await store.initializeLocalStore();
  expect(await store.getCachedMemoryDetail(scope(), memory.id)).toBeNull();
  expect(await store.getOutboxCount()).toBe(1);
  expect(await store.listTimeline(null)).toEqual([expect.objectContaining({ title: "不可替代的本机原文" })]);
});
it("HTTP revocation removes the timeline cache and cannot fall back to its stale summary", async () => {
  await store.applySyncPage(mocks.credentials!, { apiVersion: 1, serverTime: at,
    viewer: { id: "A", name: "A", role: "viewer", personId: null, canCapture: false, canEditEvents: false, canReviewInbox: false, canCreateContributions: false },
    family: { id: "family", name: "合成家庭", timezone: "UTC" }, people: [], nextCursor: null,
    events: [{ id: memory.id, title: "REVOKED_SUMMARY_TITLE", occurredAt: at, occurredAtPrecision: "unknown", locationText: "REVOKED_LOCATION", childPersonId: null, ageDays: null, ageLabel: null, updatedAt: at, assetCount: 0, participantNames: [], captureIds: [], cover: null }],
  }, "snapshot");
  await store.finishSyncSnapshot("snapshot", at);
  mocks.events = await store.listTimeline(scope());
  mocks.online = true;
  mocks.fetch.mockRejectedValue(new ApiError("Access denied", 404));
  await open();
  expect(output()).not.toContain("REVOKED_SUMMARY_TITLE");
  expect(output()).not.toContain("REVOKED_LOCATION");
  expect((await store.listTimeline(scope())).filter(event => event.source === "server")).toEqual([]);
  mocks.online = false;
  await act(async () => { tree!.update(render()); });
  expect(output()).not.toContain("REVOKED_SUMMARY_TITLE");
});
it("archived originals belong to their draft's account scope, even when another account knows the event ID", async () => {
  const { createLocalDraft, saveLocalDraft } = await import("../src/drafts/store");
  const ownScope = JSON.stringify(["https://example.test", "instance", "A", "family"]);
  const otherScope = JSON.stringify(["https://example.test", "instance", "B", "family"]);
  const draft = await createLocalDraft(ownScope, "owned-draft", "mutation-1");
  await saveLocalDraft({ ...draft, revision: 2, status: "published", memoryEventId: memory.id,
    content: { ...draft.content, occurredAtPrecision: "unknown", items: [{ id: "owned-item", assetId: "asset-a", localCaptureRef: "owned-photo", caption: "" }] } }, 1,
    { id: "owned-photo", payload: { localUri: "file:///A-PRIVATE-PHOTO.png", fileName: "A-PRIVATE-PHOTO.png", mimeType: "image/png", mediaType: "image", source: "library", lastModified: null } });
  getRawMockDatabase().prepare("update local_capture set memory_event_id=?,sync_state='archived' where id='owned-photo'").run(memory.id);
  expect(await store.listLocalMemoryMedia(memory.id, ownScope)).toHaveLength(1);
  expect(await store.listLocalMemoryMedia(memory.id, otherScope)).toEqual([]);
  expect(await store.listLocalMemoryMedia(memory.id, null)).toEqual([]);
  expect(getRawMockDatabase().prepare("select local_uri from local_capture where id='owned-photo'").get()).toEqual({ local_uri: "file:///A-PRIVATE-PHOTO.png" });
});

it("a sync permission reset withdraws already rendered private text without reopening the screen", async () => {
  await open();
  expect(output()).toContain("A_PRIVATE_ONLY");
  await act(async () => { await store.clearServerCaches(); });
  expect(output()).not.toContain("A_PRIVATE_ONLY");
  expect(await store.getCachedMemoryDetail(scope(), memory.id)).toBeNull();
});
it("a late detail response cannot refill caches after a sync permission reset", async () => {
  let resolve!: (value: MobileMemory) => void;
  mocks.online = true;
  mocks.fetch.mockReturnValueOnce(new Promise<MobileMemory>(done => { resolve = done; }))
    .mockRejectedValue(new ApiError("Access denied",404));
  await open();
  await act(async () => { await store.clearServerCaches(); });
  await act(async () => { resolve(memory); });
  expect(output()).not.toContain("A_PRIVATE_ONLY");
  expect(await store.getCachedMemoryDetail(scope(),memory.id)).toBeNull();
});
