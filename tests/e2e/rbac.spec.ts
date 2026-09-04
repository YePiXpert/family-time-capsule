import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { ensureBootstrap } from "./helpers";

test.describe.configure({ mode: "serial" });

const ORIGIN = "http://localhost:3120";
const DB_PATH = path.join(
  process.cwd(),
  "data",
  "e2e-rbac",
  "db",
  "capsule.sqlite",
);

type Role = "admin" | "editor" | "contributor" | "viewer";

function withDatabase<T>(run: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH, { timeout: 5_000 });
  db.pragma("busy_timeout = 5000");
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function setRole(role: Role): void {
  withDatabase((db) => {
    if (role !== "admin") {
      // The database correctly prevents demoting the last enabled admin. This
      // stale-action scenario needs a second administrator so the requested
      // downgrade is itself valid while the old rendered form becomes stale.
      db.prepare(`
        INSERT OR IGNORE INTO user (
          id, name, email, email_verified, role, family_id, created_at, updated_at
        )
        SELECT
          'rbac-replacement-admin', '备用管理员',
          'rbac-replacement-admin@example.com', 0, 'admin', family_id,
          unixepoch(), unixepoch()
        FROM user
        WHERE email = ?
      `).run("admin@example.com");
    }
    const result = db
      .prepare("UPDATE user SET role = ? WHERE email = ?")
      .run(role, "admin@example.com");
    expect(result.changes).toBe(1);
  });
}

function countPeople(name: string): number {
  return withDatabase(
    (db) =>
      Number(
        (
          db
            .prepare("SELECT count(*) AS value FROM person WHERE display_name = ?")
            .get(name) as { value: number }
        ).value,
      ),
  );
}

function firstOriginalAssetId(): string {
  return withDatabase(
    (db) =>
      (
        db
          .prepare(
            "SELECT id FROM asset WHERE original_asset_id IS NULL ORDER BY imported_at LIMIT 1",
          )
          .get() as { id: string }
      ).id,
  );
}

async function waitForServerAction(page: Page, pathname: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === pathname,
  );
}

test("viewer role fails closed at stale actions and HTTP write routes", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await ensureBootstrap(page);

  // Seed one unlinked Person, one event, and one contribution per author as admin.
  await page.goto("/family");
  await page.getByLabel("姓名").fill("外婆");
  await page.getByLabel("对孩子的称谓").fill("外婆");
  await page.getByRole("button", { name: "添加家人" }).click();
  await expect(page.getByText("外婆").first()).toBeVisible();

  await page.goto("/capture");
  await page
    .locator('section[aria-label="照片"] input[type="file"]')
    .setInputFiles(path.join(__dirname, "..", "fixtures", "sample-exif.jpg"));
  await expect(page.getByText("已保存，等待整理")).toBeVisible();
  await page.goto("/inbox");
  await page.getByLabel("事件标题").fill("权限边界事件");
  await page.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page.getByRole("heading", { name: "权限边界事件" })).toBeVisible();
  const memoryPath = new URL(page.url()).pathname;

  await page.getByLabel("谁在讲述").selectOption({ label: "爸爸" });
  await page.getByPlaceholder("TA 想说的那段话……").fill("爸爸自己的原文");
  await page.getByRole("button", { name: "保存这段讲述" }).click();
  await expect(page.getByText("爸爸自己的原文").first()).toBeVisible();
  await page.getByLabel("谁在讲述").selectOption({ label: "外婆" });
  await page.getByPlaceholder("TA 想说的那段话……").fill("外婆不可被代改的原文");
  await page.getByRole("button", { name: "保存这段讲述" }).click();
  await expect(page.getByText("外婆不可被代改的原文").first()).toBeVisible();

  const assetId = firstOriginalAssetId();

  // A form rendered while admin must not retain authority after the role changes.
  await page.goto("/family");
  await page.getByLabel("姓名").fill("越权新增成员");
  await page.getByLabel("对孩子的称谓").fill("陌生人");
  setRole("viewer");
  const staleFamilyAction = waitForServerAction(page, "/family");
  await page.getByRole("button", { name: "添加家人" }).click();
  await staleFamilyAction;
  expect(countPeople("越权新增成员")).toBe(0);

  // Viewer reads ordinary archive/media but cannot capture or export.
  const deniedExport = await page.request.get("/api/export");
  expect(deniedExport.status()).toBe(403);
  const deniedUpload = await page.request.post("/api/upload/image", {
    headers: { Origin: ORIGIN },
    multipart: {
      file: {
        name: "blocked.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("not-even-parsed"),
      },
    },
  });
  expect(deniedUpload.status()).toBe(403);
  const mediaRead = await page.request.get(`/api/media/${assetId}`);
  expect(mediaRead.status()).toBe(200);

  await page.goto("/capture");
  await expect(page.getByText("当前账号是只读角色")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "一级导航" }).getByText("记录"))
    .toBeVisible();
  await page.goto("/family");
  await expect(page.getByRole("heading", { name: "家人" })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加家人" })).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /导出完整备份/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "最近操作" })).toHaveCount(0);
  await page.goto(memoryPath);
  await expect(page.getByLabel("谁在讲述")).toHaveCount(0);
  await expect(page.getByLabel(/编辑 .* 的讲述/)).toHaveCount(0);
  await expect(page.getByText("爸爸自己的原文").first()).toBeVisible();
});
