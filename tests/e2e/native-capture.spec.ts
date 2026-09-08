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
    const tokens = Object.fromEntries(["user-a", "user-b", "user-c"].map(id => [id, randomUUID()]));
    for (const [id, name, role, personId] of [["user-a", "记录者", "editor", null], ["user-b", "妈妈", "viewer", "person-b"], ["user-c", "未选管理员", "admin", null]]) {
      db.prepare("insert or ignore into user(id,name,email,role,family_id,person_id,created_at,updated_at) values (?,?,?,?,?,?,unixepoch(),unixepoch())").run(id, name, `${id}@fixture.invalid`, role, family.id, personId);
      db.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at) values (?,?,?,unixepoch()+3600,unixepoch(),unixepoch())").run(randomUUID(), tokens[id!]!, id);
    }
    const bootstrap = await (await page.request.get("/api/bootstrap")).json();
    fixture = { credentials: { serverUrl: baseURL, token: tokens["user-a"], instanceId: bootstrap.instanceId }, family, people, userId: "user-a", readerToken: tokens["user-b"], thirdToken: tokens["user-c"], readerCount: 3 };
  } finally { db.close(); }
  const result = await promisify(execFile)(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.http.config.ts"], {
    cwd: path.join(process.cwd(), "mobile"), env: { ...process.env, FTC_NATIVE_HTTP_FIXTURE: JSON.stringify(fixture) }, timeout: 45000, maxBuffer: 1024 * 1024,
  });
  expect(result.stdout).toContain("3 passed");
  const verify = new Database(path.join(process.cwd(), "data/e2e-native-capture/db/capsule.sqlite"));
  try {
    const originals=verify.prepare("select id,visibility from asset where created_by_user_id='user-a' and original_asset_id is null").all();
    expect(originals).toHaveLength(5);
    expect(originals.every(a=>(a as {visibility:string}).visibility==='private')).toBe(true);
    expect(verify.prepare("select count(*) n from inbox_item_asset where asset_id in (select id from asset where created_by_user_id='user-a')").get()).toEqual({n:0});
  } finally { verify.close(); }
});

test("Web can remove a departed reader while keeping the other selected account", async ({ page }) => {
  await ensureBootstrap(page);
  await page.goto("/capture");
  await page.getByLabel("写下这一刻").fill("联网核对读者后再保存");
  await page.getByLabel("标题", { exact: true }).fill("读者核对记录");
  await page.getByLabel("时间记得多清楚").selectOption("unknown");
  await page.getByLabel("保存后的读者").selectOption("members");
  const group = page.getByRole("group", { name: "可以阅读的登录成员（始终包含自己）" });
  await group.getByLabel("妈妈", { exact: true }).check();
  await group.getByLabel("记录者", { exact: true }).check();
  await expect(page.getByRole("status").filter({ hasText: "本机已保存 ·" })).toBeVisible();
  const db = new Database(path.join(process.cwd(), "data/e2e-native-capture/db/capsule.sqlite"));
  try { db.prepare("update user set disabled_at=unixepoch() where id='user-b'").run(); }
  finally { db.close(); }
  await page.reload();
  await group.getByLabel("已选成员（待联网核对，点按移除）").click();
  await expect(group.getByLabel("已选成员（待联网核对，点按移除）")).toHaveCount(0);
  await expect(group.getByLabel("记录者", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "保存为一条记忆" }).click();
  await expect(page.getByRole("link", { name: "查看这条记忆" })).toBeVisible();
});

test("Web draft-only sync uploads new attachments privately before explicit publication", async ({ page }) => {
  test.setTimeout(90000);
  await ensureBootstrap(page);
  await page.goto("/capture");
  await page.getByLabel("写下这一刻").fill("网页上的私密附件记录");
  await page.getByLabel("标题", {exact:true}).fill("私密草稿附件测试");
  await page.getByLabel("时间记得多清楚").selectOption("unknown");
  await page.getByLabel("保存后的读者").selectOption("private");
  await page.getByLabel("添加照片、视频、录音或文档").setInputFiles({name:"web-private.txt",mimeType:"text/plain",buffer:Buffer.from("网页私密原件，尚未发布给家人")});
  await expect(page.getByRole("status").filter({hasText:"本机已保存 ·"})).toBeVisible();
  await page.getByRole("button",{name:"保留草稿，稍后继续"}).click();
  await expect(page.getByText("服务器已收到草稿，可以换设备继续。尚未创建正式记忆。")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("标题",{exact:true})).toHaveValue("私密草稿附件测试");
  const db=new Database(path.join(process.cwd(),"data/e2e-native-capture/db/capsule.sqlite"));
  try {
    const draft=db.prepare("select id,status,memory_event_id from draft where title='私密草稿附件测试'").get() as {id:string;status:string;memory_event_id:string|null};
    expect(draft).toMatchObject({status:"editing",memory_event_id:null});
    const assets=db.prepare("select a.id,a.visibility from draft_item i join asset a on a.id=i.asset_id where i.draft_id=?").all(draft.id) as {id:string;visibility:string}[];
    expect(assets).toHaveLength(1);expect(assets[0].visibility).toBe("private");
    expect(db.prepare("select count(*) n from inbox_item_asset where asset_id=?").get(assets[0].id)).toEqual({n:0});
    const token=randomUUID();db.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at) values (?,?, 'user-c',unixepoch()+3600,unixepoch(),unixepoch())").run(randomUUID(),token);
    const response=await page.request.get(`/api/media/${assets[0].id}`,{headers:{authorization:`Bearer ${token}`}});
    expect(response.status()).toBe(404);
  } finally {db.close();}
  await page.getByRole("button",{name:"保存为一条记忆"}).click();
  await expect(page.getByRole("link",{name:"查看这条记忆"})).toBeVisible();
  const detailLink = (await page.getByRole("link", { name: "查看这条记忆" }).getAttribute("href"))!;
  const eventId = detailLink.split("/").at(-1)!;
  await page.goto(detailLink);
  await expect(page.locator("main")).toContainText("网页上的私密附件记录");
  const cleanupDraft = new Database(path.join(process.cwd(), "data/e2e-native-capture/db/capsule.sqlite"));
  let adminToken: string;
  try {
    cleanupDraft.pragma("foreign_keys = ON");
    cleanupDraft.prepare("delete from draft where memory_event_id=?").run(eventId);
    adminToken = randomUUID();
    cleanupDraft.prepare("insert into session(id,token,user_id,expires_at,created_at,updated_at,recent_auth_at) values (?,?,'user-c',unixepoch()+3600,unixepoch(),unixepoch(),unixepoch())").run(randomUUID(), adminToken);
  } finally { cleanupDraft.close(); }
  await promisify(execFile)("npm", ["run", "search:rebuild"], { cwd: process.cwd(), env: { ...process.env, DATA_DIR: path.join(process.cwd(), "data/e2e-native-capture") }, timeout: 30000, maxBuffer: 1024 * 1024 });
  await page.reload();
  await expect(page.locator("main")).toContainText("网页上的私密附件记录");
  await page.goto("/search?q=" + encodeURIComponent("私密附件"));
  await expect(page.getByRole("link", { name: /私密草稿附件测试/ })).toBeVisible();
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
  await ensureBootstrap(page);
  await page.goto("/capture");
  await page.getByRole("button", { name: "新建一件事" }).click();
  await page.getByLabel("标题", { exact: true }).fill("网页确认的实况照片");
  await page.getByLabel("时间记得多清楚").selectOption("unknown");
  await page.getByLabel("保存后的读者").selectOption("private");
  await page.getByLabel("添加照片、视频、录音或文档").setInputFiles([
    { name: "still.jpg", mimeType: "image/jpeg", buffer: readFileSync(path.join(__dirname,"../fixtures/sample.jpg")) },
    { name: "motion.mov", mimeType: "video/quicktime", buffer: readFileSync(path.join(__dirname,"../fixtures/sample.mov")) },
  ]);
  await page.getByRole("button", { name: "确认与上一张照片组成 Live Photo" }).click();
  await expect(page.getByText("Live Photo · 静态照片（移除时整组操作）")).toBeVisible();
  await page.getByRole("button", { name: "保存为一条记忆" }).click();
  await page.getByRole("link", { name: "查看这条记忆" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "网页确认的实况照片" })).toBeVisible();
  await expect(page.getByText("Live Photo 已保留静态照片和动态原片，可在下方分别查看与播放。")).toBeVisible();
  await page.reload();
  await expect(page.getByText("原始资料（2）")).toBeVisible();
});
