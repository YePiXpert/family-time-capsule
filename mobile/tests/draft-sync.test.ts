import { beforeEach, expect, it, vi } from "vitest";
import { initializeLocalStore, setActiveDestination } from "../src/storage/database";
import { createLocalDraft, listLocalDrafts, saveLocalDraft } from "../src/drafts/store";
import { syncLocalDrafts } from "../src/drafts/sync";
import { getRawMockDatabase } from "../../tests/mocks/expo-sqlite";
import { ApiError, requestMobileJson } from "../src/api/client";
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("../src/api/client", async importOriginal => ({ ...await importOriginal<typeof import("../src/api/client")>(), requestMobileJson: vi.fn() }));
const credentials = { serverUrl: "https://fixture.invalid", instanceId: "instance-a", token: "fictional-token" };
const scope = JSON.stringify([credentials.serverUrl, credentials.instanceId, "user-a", "family-a"]);
beforeEach(async () => { vi.clearAllMocks(); await initializeLocalStore(); getRawMockDatabase().exec("DELETE FROM local_draft; DELETE FROM local_capture; DELETE FROM outbox"); await setActiveDestination(scope); });
it("publishes only after originals and authorization, and recovers a lost publication response without another event", async () => {
  let row = await createLocalDraft(scope, "draft-sync", "mutation-sync");
  row = { ...row, status: "queued", revision: 2, content: { ...row.content, text: "混合的一件事", occurredAt: "1980-08-12T00:00:00.000Z", items: [{ id: "item-a", assetId: null, localCaptureRef: "capture-a", caption: "原件说明" }] } };
  getRawMockDatabase().exec("INSERT INTO local_capture(id,kind,title,occurred_at,local_uri,media_type,inbox_item_id,sync_state) VALUES('capture-a','media_capture','photo.jpg','1980-08-12','file:///photo.jpg','image','inbox-a','inbox')");
  await saveLocalDraft(row, 1);
  const server = { ...row.content, id: row.id, status: "editing", memoryEventId: null, revision: 1, mutationId: row.mutationId, createdAt: row.updatedAt, updatedAt: row.updatedAt };
  let published = false;
  vi.mocked(requestMobileJson).mockImplementation(async (_credentials, path) => {
    if (path === "/api/mobile/v1/inbox/inbox-a") return { assets: [{ id: "asset-a" }] };
    if (path.endsWith("/publish")) { published = true; throw new ApiError("lost response", 0); }
    if (path.endsWith("draft-sync")) {
      if (published) return { ...server, status: "published", memoryEventId: "memory-one", revision: 2 };
      return server;
    }
    throw new Error("unexpected request");
  });
  await syncLocalDrafts(credentials, { authorizeUpload: async () => false });
  expect(requestMobileJson).not.toHaveBeenCalled();
  await expect(syncLocalDrafts(credentials, { authorizeUpload: async () => true })).rejects.toThrow("lost response");
  const saveCall = vi.mocked(requestMobileJson).mock.calls.find(([, , init]) => init?.method === "PUT")!;
  expect(JSON.parse(String(saveCall[2]!.body)).content.items).toEqual([{ ...row.content.items[0], assetId: "asset-a" }]);
  expect((await listLocalDrafts(scope))[0]?.status).toBe("queued");
  await syncLocalDrafts(credentials, { authorizeUpload: async () => true });
  expect((await listLocalDrafts(scope))[0]).toMatchObject({ status: "published", memoryEventId: "memory-one" });
  expect(vi.mocked(requestMobileJson).mock.calls.filter(([, path]) => path.endsWith("/publish"))).toHaveLength(1);
});
it("a destination change while receiving a response cannot update another account's draft", async () => {
  const row = await createLocalDraft(scope, "draft-switch", "mutation-switch");
  await saveLocalDraft({ ...row, status: "queued", revision: 2, content: { ...row.content, text: "账号隔离", occurredAt: "2026-09-07T00:00:00Z" } }, 1);
  vi.mocked(requestMobileJson).mockImplementation(async () => { await setActiveDestination("another-account-family"); return { ...row.content, id: row.id, status: "published", memoryEventId: "foreign-event", revision: 2 }; });
  await expect(syncLocalDrafts(credentials, { authorizeUpload: async () => true })).rejects.toThrow("连接已切换");
  expect((await listLocalDrafts(scope))[0]).toMatchObject({ status: "queued", memoryEventId: null });
  expect(await listLocalDrafts("another-account-family")).toEqual([]);
});

it("continues a mixed server draft without duplicating originals, and sends discard without upload consent", async () => {
  const row = await createLocalDraft(scope, "continued", "mutation-continued");
  const content = { ...row.content, title: "跨设备的一件事", text: "服务器收到过的草稿", items: [{ id: "server-item", assetId: "server-asset", localCaptureRef: null, caption: "只引用" }] };
  await saveLocalDraft({ ...row, content, status: "queued", syncIntent: "draft", revision: 2, serverRevision: 3 }, 1);
  const remote = { ...content, id: row.id, status: "editing", memoryEventId: null, revision: 4, mutationId: row.mutationId, createdAt: row.updatedAt, updatedAt: row.updatedAt };
  vi.mocked(requestMobileJson).mockResolvedValue(remote);
  await syncLocalDrafts(credentials, { authorizeUpload: async () => true });
  const delivered = (await listLocalDrafts(scope))[0]!;
  expect(delivered).toMatchObject({ status: "editing", serverRevision: 4 });
  expect(delivered.revision).toBe(delivered.syncedRevision);
  expect(getRawMockDatabase().prepare("SELECT count(*) AS n FROM local_capture").get()).toEqual({ n: 0 });
  expect(vi.mocked(requestMobileJson).mock.calls.some(([, path]) => path.includes("/inbox/") || path.endsWith("/publish"))).toBe(false);
  await saveLocalDraft({ ...delivered, status: "discarded", discardPending: true, revision: delivered.revision + 1 }, delivered.revision);
  vi.mocked(requestMobileJson).mockClear();
  await syncLocalDrafts(credentials, { authorizeUpload: async () => false });
  expect(requestMobileJson).toHaveBeenCalledWith(credentials, "/api/mobile/v1/drafts/continued", expect.objectContaining({ method: "DELETE" }));
  expect((await listLocalDrafts(scope))[0]).toMatchObject({ status: "discarded", discardPending: false });
});
