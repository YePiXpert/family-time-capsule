import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
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
  expect(result.stdout).toContain("1 passed");
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
