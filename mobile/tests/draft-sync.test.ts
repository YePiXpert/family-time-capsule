import { beforeEach, expect, it, vi } from "vitest";
import { initializeLocalStore, setActiveDestination } from "../src/storage/database";
import { createLocalDraft, listLocalDrafts, saveLocalDraft } from "../src/drafts/store";
import { syncLocalDrafts } from "../src/drafts/sync";
import { getRawMockDatabase } from "../../tests/mocks/expo-sqlite";
import { ApiError, requestMobileJson } from "../src/api/client";
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("../src/storage/files", () => ({ uploadMediaCaptureReceipt: vi.fn(async () => ({assetId: "asset-a", inboxItemId: null})) }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("../src/api/client", async importOriginal => ({ ...await importOriginal<typeof import("../src/api/client")>(), requestMobileJson: vi.fn() }));
const credentials = { serverUrl: "https://fixture.invalid", instanceId: "instance-a", token: "fictional-token" };
const scope = JSON.stringify([credentials.serverUrl, credentials.instanceId, "user-a", "family-a"]);
beforeEach(async () => { vi.clearAllMocks(); await initializeLocalStore(); getRawMockDatabase().exec("DELETE FROM local_draft; DELETE FROM local_capture; DELETE FROM outbox"); await setActiveDestination(scope); });
it("publishes only after originals and authorization, and recovers a lost publication response without another event", async () => {
  let row = await createLocalDraft(scope, "draft-sync", "mutation-sync");
  row = { ...row, status: "queued", revision: 2, content: { ...row.content, text: "混合的一件事", occurredAt: "1980-08-12T00:00:00.000Z", items: [{ id: "item-a", assetId: null, localCaptureRef: "capture-a", caption: "原件说明" }] } };
  getRawMockDatabase().exec("INSERT INTO local_capture(id,kind,title,occurred_at,local_uri,media_type,inbox_item_id,sync_state) VALUES('capture-a','media_capture','photo.jpg','1980-08-12','file:///photo.jpg','image','inbox-a','inbox')");
  getRawMockDatabase().prepare("UPDATE local_capture SET payload_json=? WHERE id='capture-a'").run(JSON.stringify({localUri:"file:///photo.jpg",fileName:"photo.jpg",mimeType:"image/jpeg",lastModified:null,mediaType:"image",source:"library"}));
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
  const saveCall = vi.mocked(requestMobileJson).mock.calls.filter(([, , init]) => init?.method === "PUT").at(-1)!;
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

it("reconciles duplicate originals and the cover without deleting either local file", async () => {
  let row = await createLocalDraft(scope, "same-photo-draft", "same-photo-mutation");
  const payload = {localUri:"file:///same.png",fileName:"same.png",mimeType:"image/png",lastModified:null,mediaType:"image" as const,source:"library" as const};
  for (const id of ["same-a","same-b"]) {
    const next = {...row,revision:row.revision+1,content:{...row.content,visibility:"private" as const,items:[...row.content.items,{id,assetId:null,localCaptureRef:id,caption:""}],coverItemId:id}};
    await saveLocalDraft(next,row.revision,{id,payload});row=next;
  }
  await saveLocalDraft({...row,revision:row.revision+1,status:"queued",syncIntent:"draft"},row.revision);
  vi.mocked(requestMobileJson).mockImplementation(async (_credentials,_path,init)=>{
    const body=init?.body?JSON.parse(String(init.body)):null;
    return {...(body?.content??row.content),id:row.id,status:"editing",memoryEventId:null,revision:(body?.expectedRevision??0)+1,mutationId:body?.mutationId??row.mutationId,createdAt:row.updatedAt,updatedAt:row.updatedAt};
  });
  await syncLocalDrafts(credentials,{authorizeUpload:async()=>true});
  const saved=(await listLocalDrafts(scope))[0]!;
  expect(saved.status).toBe("editing");
  expect(saved.content.items).toEqual([{id:"same-a",assetId:"asset-a",localCaptureRef:"same-a",caption:""}]);
  expect(saved.content.coverItemId).toBe("same-a");
  expect(getRawMockDatabase().prepare("SELECT count(*) n FROM local_capture").get()).toEqual({n:2});
});
