import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { FamilyContext } from "@/lib/family/context";
const dir = mkdtempSync(path.join(tmpdir(), "ftc-voice-authorization-"));
process.env.DATA_DIR = dir;
process.env.AUTH_SECRET = "synthetic-private-contribution-event";
const { getDb, closeDatabase } = await import("@/db");
const { family, person } = await import("@/db/schema/family");
const { user, session } = await import("@/db/schema/auth");
const { memoryEvent } = await import("@/db/schema/memory");
const access = await import("@/lib/authz/contribution-access");
const service = await import("@/lib/contributions/service");
const { storeOriginal } = await import("@/lib/assets/service");
const media = await import("@/app/api/media/[assetId]/route");
getDb().insert(family).values({ id: "family", name: "合成讲述家庭", timezone: "UTC" }).run();
for (const id of ["a", "b", "c"]) {
  getDb().insert(person).values({ id: `person-${id}`, familyId: "family", displayName: "同名家人" }).run();
  getDb().insert(user).values({ id, familyId: "family", personId: `person-${id}`, name: "同名账号", email: `${id}@fixture.invalid`, role: "admin" }).run();
  getDb().insert(session).values({ id, userId: id, token: `${id}-synthetic-contribution`, expiresAt: new Date(Date.now() + 3600000) }).run();
}
const ctx = (id: string): FamilyContext => ({ userId: id, userName: "同名账号", familyId: "family", personId: `person-${id}`, role: "admin", accountEnabled: true, isGuardian: false, familyTimezone: "UTC", childLaterUnlockAge: 18 });
const snapshot = (id: string) => access.createContributionAccessSnapshot(ctx(id));
function request(actor: string, method = "GET", body?: unknown, range?: string) {
  return new Request("http://localhost/api/test", { method, headers: { authorization: `Bearer ${actor}-synthetic-contribution`, "content-type": "application/json", ...(range ? { range } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
const api = await import("@/app/api/mobile/v1/memories/[id]/contributions/route");
getDb().update(user).set({role:"contributor"}).where(eq(user.id,"b")).run();
const contributorSnapshot = () => access.createContributionAccessSnapshot({...ctx("b"),role:"contributor"});

it("rejects unreadable audio before another contributor can revoke the original author's access", async () => {
  const eventId=randomUUID();
  getDb().insert(memoryEvent).values({id:eventId,familyId:"family",title:"shared event",status:"confirmed",occurredAt:new Date(),createdByUserId:"a"}).run();
  const stored=await storeOriginal({familyId:"family",createdByUserId:"a",type:"audio",originalFilename:"shared.wav",mimeType:"audio/wav",buffer:readFileSync(path.join(__dirname,"../fixtures/sample.wav")),extension:"wav",timeSource:"import_time",visibility:"family"});
  if(stored.status!=="stored")throw Error("fixture");
  const audioAssetId=stored.asset.id;
  expect((await service.createContribution("family",{memoryEventId:eventId,authorPersonId:"person-a",recordedByUserId:"a",audioAssetId,visibility:"private"})).ok).toBe(true);
  expect(await access.canReadContributionAsset(contributorSnapshot(),audioAssetId)).toBe(false);
  const before=getDb().all(sql`select id from contribution where memory_event_id=${eventId}`);
  const response=await api.POST(request("b","POST",{authorPersonId:"person-b",audioAssetId,visibility:"private"}),{params:Promise.resolve({id:eventId})});
  expect(response.status).toBe(403);
  expect(getDb().all(sql`select id from contribution where memory_event_id=${eventId}`)).toEqual(before);
  expect(await access.canReadContributionAsset(snapshot("a"),audioAssetId)).toBe(true);
  const playback=await media.GET(request("a","GET",undefined,"bytes=0-11"),{params:Promise.resolve({assetId:audioAssetId})});
  expect(playback.status).toBe(206);await playback.arrayBuffer();
});

it("allows a contributor to publish their own private recording and retry it once", async () => {
  const eventId=randomUUID();
  getDb().insert(memoryEvent).values({id:eventId,familyId:"family",title:"own voice",status:"confirmed",occurredAt:new Date(),createdByUserId:"a"}).run();
  const stored=await storeOriginal({familyId:"family",createdByUserId:"b",type:"audio",originalFilename:"own.wav",mimeType:"audio/wav",buffer:Buffer.concat([readFileSync(path.join(__dirname,"../fixtures/sample.wav")),Buffer.from(eventId)]),extension:"wav",timeSource:"import_time",visibility:"private"});
  if(stored.status!=="stored")throw Error("fixture");
  const input={authorPersonId:"person-b",audioAssetId:stored.asset.id,visibility:"family",clientId:randomUUID()};
  for(let attempt=0;attempt<2;attempt++) {
    const response=await api.POST(request("b","POST",input),{params:Promise.resolve({id:eventId})});
    expect(response.status).toBe(201);
  }
  expect(getDb().all(sql`select id from contribution where memory_event_id=${eventId}`)).toHaveLength(1);
  expect(await access.canReadContributionAsset(snapshot("a"),stored.asset.id)).toBe(true);
});

it("acknowledges an exact on-behalf retry after the private recording becomes unreadable to its recorder", async () => {
  const eventId=randomUUID(), authorPersonId=randomUUID(), clientId=randomUUID();
  getDb().insert(person).values({id:authorPersonId,familyId:"family",displayName:"外婆"}).run();
  getDb().insert(memoryEvent).values({id:eventId,familyId:"family",title:"grandma's voice",status:"confirmed",occurredAt:new Date(),createdByUserId:"a"}).run();
  const stored=await storeOriginal({familyId:"family",createdByUserId:"a",type:"audio",originalFilename:"grandma.wav",mimeType:"audio/wav",buffer:Buffer.concat([readFileSync(path.join(__dirname,"../fixtures/sample.wav")),Buffer.from(eventId)]),extension:"wav",timeSource:"import_time",visibility:"private"});
  if(stored.status!=="stored")throw Error("fixture");
  const input={memoryEventId:eventId,authorPersonId,recordedByUserId:"a",audioAssetId:stored.asset.id,visibility:"private" as const,clientId};
  expect(await service.createContribution("family",input)).toEqual({ok:true,contributionId:clientId});
  expect(await access.canReadContributionAsset(snapshot("a"),stored.asset.id)).toBe(false);
  expect(await service.createContribution("family",input)).toEqual({ok:true,contributionId:clientId});
  expect(await service.createContribution("family",{...input,clientId:randomUUID()})).toEqual({ok:false,error:"forbidden"});
  expect(getDb().all(sql`select id from contribution where memory_event_id=${eventId}`)).toHaveLength(1);
});
