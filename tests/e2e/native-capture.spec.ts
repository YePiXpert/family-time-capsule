import { readCaptureDraft, waitForCapture, startCaptureDraft, setCaptureMetadata, submitCaptureForReview } from "./helpers/capture";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { grantExportStepUp } from "./helpers/export-step-up";
import { ensureBootstrap } from "./helpers";

test.describe.configure({ mode: "serial" });

test("native recording controls and save hook publish specified readers through production HTTP", async ({ page, baseURL }) => {
  test.setTimeout(60000);
  await ensureBootstrap(page);
  // Only this project's synthetic database is touched. The native renderer uses
  // real fetch, the production API/auth stack and its own real SQLite store.
  const db = new Database(path.join(process.cwd(), "data/e2e-native-capture/db/capsule.sqlite"));
  let fixture;
  try {
    db.pragma("foreign_keys = ON");
    const family = db.prepare("select id,name,timezone from family").get() as { id: string; name: string; timezone: string };
    const people = [{ id: "person-b", displayName: "妈妈" }, { id: "person-no-account", displayName: "外公" }];
    for (const person of people) db.prepare("insert or ignore into person(id,family_id,display_name,created_at,updated_at) values (?,?,?,unixepoch(),unixepoch())").run(person.id, family.id, person.displayName);
    // Give every attempt its own upload/import owner. Keep only this attempt's
    // synthetic author active, so retries preserve exact counts and reader UI.
    // B/C stay stable for the subsequent Web cases in this serial group.
    db.prepare("update user set disabled_at=unixepoch() where family_id=? and email like 'native-capture-author-%@fixture.invalid'").run(family.id);
    const authorId = `native-capture-author-${randomUUID()}`;
    const tokens = Object.fromEntries([authorId, "user-b", "user-c"].map(id => [id, randomUUID()]));
    for (const [id, name, role, personId] of [[authorId, "记录者", "editor", null], ["user-b", "妈妈", "viewer", "person-b"], ["user-c", "未选管理员", "admin", null]]) {
      db.prepare("insert into user(id,name,email,role,family_id,person_id,created_at,updated_at) values (?,?,?,?,?,?,unixepoch(),unixepoch()) on conflict(id) do update set disabled_at=null,person_id=excluded.person_id").run(id, name, `${id}@fixture.invalid`, role, family.id, personId);
      db.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at) values (?,?,?,unixepoch()+3600,unixepoch(),unixepoch())").run(randomUUID(), tokens[id!]!, id);
    }
    const bootstrap = await (await page.request.get("/api/bootstrap")).json();
    fixture = { credentials: { serverUrl: baseURL, token: tokens[authorId], instanceId: bootstrap.instanceId }, family, people, userId: authorId, readerToken: tokens["user-b"], thirdToken: tokens["user-c"], readerCount: 3 };
  } finally { db.close(); }
  const result = await promisify(execFile)(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.http.config.ts"], {
    cwd: path.join(process.cwd(), "mobile"), env: { ...process.env, FTC_NATIVE_HTTP_FIXTURE: JSON.stringify(fixture) }, timeout: 45000, maxBuffer: 1024 * 1024,
  });
  expect(result.stdout).toContain("4 passed");
  const verify = new Database(path.join(process.cwd(), "data/e2e-native-capture/db/capsule.sqlite"));
  try {
    const originals=verify.prepare("select id,visibility from asset where created_by_user_id=? and original_asset_id is null").all(fixture.userId);
    expect(originals).toHaveLength(5);
    expect(originals.every(a=>(a as {visibility:string}).visibility==='private')).toBe(true);
    expect(verify.prepare("select count(*) n from inbox_item_asset where asset_id in (select id from asset where created_by_user_id=?)").get(fixture.userId)).toEqual({n:0});
    const voice = verify.prepare("select a.id assetId,ma.memory_event_id eventId,a.family_id familyId from asset a join memory_event_asset ma on ma.asset_id=a.id where a.created_by_user_id=? and a.type='audio' and a.original_asset_id is null limit 1").get(fixture.userId) as { assetId: string; eventId: string; familyId: string };
    verify.prepare("insert or ignore into person(id,family_id,display_name,created_at,updated_at) values ('person-c',?,'旧讲述作者',unixepoch(),unixepoch())").run(voice.familyId);
    verify.prepare("update user set person_id='person-c' where id='user-c'").run();
    // Fixture grants B access to the previously private native event. The old
    // family narration must not create a parallel grant for its former author C.
    verify.prepare("update memory_event set visibility='members' where id=?").run(voice.eventId);
    verify.prepare("insert into memory_event_reader(id,family_id,memory_event_id,user_id,created_at) values (?,?,?,'user-b',unixepoch())").run(randomUUID(), voice.familyId, voice.eventId);
    const narration = randomUUID();
    verify.prepare("insert into contribution(id,memory_event_id,author_person_id,raw_text,visibility,audio_asset_id,created_at,updated_at) values (?,?,'person-c','撤权后隐藏的旧讲述','family',?,unixepoch(),unixepoch())").run(narration, voice.eventId, voice.assetId);
    const deniedHeaders = { authorization: `Bearer ${fixture.thirdToken}` };
    const allowedVoice = await page.request.get(`/api/media/${voice.assetId}`, { headers: { authorization: `Bearer ${fixture.readerToken}`, range: "bytes=0-11" } });
    expect(allowedVoice.status()).toBe(206);
    expect((await allowedVoice.body()).length).toBe(12);
    expect((await page.request.get(`/api/media/${voice.assetId}`, { headers: { ...deniedHeaders, range: "bytes=0-11" } })).status()).toBe(404);
    expect((await page.request.patch(`/api/mobile/v1/contributions/${narration}`, { headers: deniedHeaders, data: { text: "不能继续编辑撤权事件" } })).status()).toBe(404);
    expect((await page.request.post(`/api/mobile/v1/memories/${voice.eventId}/contributions`, { headers: deniedHeaders, data: { authorPersonId: "person-c", text: "不能向撤权事件投递", visibility: "family" } })).status()).toBe(404);
  } finally { verify.close(); }
});

test("Web can remove a departed reader while keeping the other selected account", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/capture"); await waitForCapture(page);
  await page.getByLabel("写下这一刻").fill("联网核对读者后再保存");
  await waitForCapture(page); await setCaptureMetadata(page, { title: "读者核对记录" });
  await waitForCapture(page); await setCaptureMetadata(page, { occurredAt: null, occurredAtPrecision: "unknown" });
  await page.getByRole("button", { name: "指定成员", exact: true }).click();
  const group = page.getByRole("group", { name: "保存后的读者" });
  await group.getByLabel("妈妈", { exact: true }).check();
  await group.getByLabel("记录者", { exact: true }).check();
  await expect(page.getByRole("status").filter({ hasText: "本机已保存 ·" })).toBeVisible();
  const db = new Database(path.join(process.cwd(), "data/e2e-native-capture/db/capsule.sqlite"));
  try { db.prepare("update user set disabled_at=unixepoch() where id='user-b'").run(); }
  finally { db.close(); }
  await page.reload(); await waitForCapture(page);
  await group.getByLabel("已选成员（待联网核对，点按移除）").click();
  await expect(group.getByLabel("已选成员（待联网核对，点按移除）")).toHaveCount(0);
  await expect(group.getByLabel("记录者", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("link", { name: "查看这条记忆" })).toBeVisible();
});

test("Web draft-only sync uploads new attachments privately before explicit publication", async ({ page }) => {
  test.setTimeout(90000);
  const title = `私密草稿附件测试 ${randomUUID()}`;
  await ensureBootstrap(page);
  await page.goto("/capture"); await waitForCapture(page);
  await page.getByLabel("写下这一刻").fill("网页上的私密附件记录");
  await waitForCapture(page); await setCaptureMetadata(page, { title });
  await waitForCapture(page); await setCaptureMetadata(page, { occurredAt: null, occurredAtPrecision: "unknown" });
  await page.getByRole("button", { name: "仅自己", exact: true }).click();
  await page.getByLabel("添加照片、视频、录音或文档").setInputFiles({name:"web-private.txt",mimeType:"text/plain",buffer:Buffer.from("网页私密原件，尚未发布给家人")});
  await expect(page.getByRole("status").filter({hasText:"本机已保存 ·"})).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^本机已保存 ·/ })).toBeVisible();
  const draftId = (await readCaptureDraft(page)).id;
  await submitCaptureForReview(page, false);
  await page.reload(); await waitForCapture(page);
  expect(await readCaptureDraft(page)).toMatchObject({ id: draftId, content: { title } });
  const db=new Database(path.join(process.cwd(),"data/e2e-native-capture/db/capsule.sqlite"));
  try {
    const draft=db.prepare("select id,status,memory_event_id from draft where id=?").get(draftId) as {id:string;status:string;memory_event_id:string|null};
    expect(draft).toMatchObject({status:"editing",memory_event_id:null});
    const assets=db.prepare("select a.id,a.visibility from draft_item i join asset a on a.id=i.asset_id where i.draft_id=?").all(draft.id) as {id:string;visibility:string}[];
    expect(assets).toHaveLength(1);expect(assets[0].visibility).toBe("private");
    expect(db.prepare("select count(*) n from inbox_item_asset where asset_id=?").get(assets[0].id)).toEqual({n:0});
    const token=randomUUID();db.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at) values (?,?, 'user-c',unixepoch()+3600,unixepoch(),unixepoch())").run(randomUUID(),token);
    const response=await page.request.get(`/api/media/${assets[0].id}`,{headers:{authorization:`Bearer ${token}`}});
    expect(response.status()).toBe(404);
  } finally {db.close();}
  await page.getByRole("button",{name:"保存"}).click();
  await expect(page.getByRole("link",{name:"查看这条记忆"})).toBeVisible();
  const detailLink = (await page.getByRole("link", { name: "查看这条记忆" }).getAttribute("href"))!;
  const eventId = detailLink.split("/").at(-1)!;
  await page.goto(detailLink);
  await expect(page.locator("main")).toContainText("网页上的私密附件记录");
  const cleanupDraft = new Database(path.join(process.cwd(), "data/e2e-native-capture/db/capsule.sqlite"));
  let adminToken: string;
  try {
    cleanupDraft.pragma("foreign_keys = ON");
    expect(cleanupDraft.prepare("delete from draft where id=? and memory_event_id=?").run(draftId, eventId).changes).toBe(1);
    adminToken = randomUUID();
    cleanupDraft.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at,recent_auth_at) values (?,?,'user-c',unixepoch()+3600,unixepoch(),unixepoch(),unixepoch())").run(randomUUID(), adminToken);
  } finally { cleanupDraft.close(); }
  await promisify(execFile)("npm", ["run", "search:rebuild"], { cwd: process.cwd(), env: { ...process.env, DATA_DIR: path.join(process.cwd(), "data/e2e-native-capture") }, timeout: 30000, maxBuffer: 1024 * 1024 });
  await page.reload(); await waitForCapture(page);
  await expect(page.locator("main")).toContainText("网页上的私密附件记录");
  await page.goto("/search?q=" + encodeURIComponent("私密附件"));
  await expect(page.getByRole("link", { name: title, exact: true }).and(page.locator(`a[href="/memories/${eventId}"]`))).toBeVisible();
  await grantExportStepUp(page);
  const ownArchive = await page.request.get("/api/export");
  expect(ownArchive.status()).toBe(200);
  const { default: JSZip } = await import("jszip");
  const ownZip = await JSZip.loadAsync(Buffer.from(await ownArchive.body()));
  const exported = JSON.parse(await ownZip.file("family-time-capsule-export/memories.json")!.async("string"));
  expect(exported.find((e: { id: string }) => e.id === eventId)).toMatchObject({ bodyText: "网页上的私密附件记录", occurredAtPrecision: "unknown" });
  expect((await page.request.get(`/api/mobile/v1/memories/${eventId}`, { headers: { authorization: `Bearer ${adminToken}` } })).status()).toBe(404);
  const otherArchive = await page.request.get("/api/export", { headers: { authorization: `Bearer ${adminToken}` } });
  expect(otherArchive.status()).toBe(200);
  const otherZip = await JSZip.loadAsync(Buffer.from(await otherArchive.body()));
  expect(await otherZip.file("family-time-capsule-export/memories.json")!.async("string")).not.toContain(eventId);
});

test("Web separately imported Live Photo components stay paired after explicit selection and publication", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const title = `网页确认的实况照片 ${randomUUID()}`;
  await ensureBootstrap(page);
  await page.goto("/capture"); await waitForCapture(page);
  await startCaptureDraft(page);
  await waitForCapture(page); await setCaptureMetadata(page, { title });
  await waitForCapture(page); await setCaptureMetadata(page, { occurredAt: null, occurredAtPrecision: "unknown" });
  await page.getByRole("button", { name: "仅自己", exact: true }).click();
  await page.getByLabel("添加照片、视频、录音或文档").setInputFiles([
    { name: "still.jpg", mimeType: "image/jpeg", buffer: readFileSync(path.join(__dirname,"../fixtures/sample.jpg")) },
    { name: "motion.mov", mimeType: "video/quicktime", buffer: readFileSync(path.join(__dirname,"../fixtures/sample.mov")) },
  ]);
  await page.getByRole("button", { name: "确认与上一张照片组成 Live Photo" }).click();
  await expect(page.getByText("Live Photo · 照片")).toBeVisible();
  await page.getByRole("button", { name: "保存" }).click();
  await page.getByRole("link", { name: "查看这条记忆" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
  await expect(page.getByText("Live Photo 已保留静态照片和动态原片，可在下方分别查看与播放。")).toBeVisible();
  await page.reload(); await waitForCapture(page);
  await expect(page.getByText("原始资料（2）")).toBeVisible();
});
