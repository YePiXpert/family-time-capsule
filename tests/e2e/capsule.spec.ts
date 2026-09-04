import { expect, test } from "@playwright/test";
import path from "node:path";
import { ensureBootstrap, ensureLogin } from "./helpers";

// Slice 5（PRD §23）：胶囊创建 → 加事件 → Seal → 锁定状态 / 到期开启
// RH-006：本 spec 自包含（独立 DATA_DIR，自行 bootstrap + 自建事件）
test.describe.configure({ mode: "serial" });

/** 为胶囊准备一个可引用的记忆事件 */
async function createReferencedEvent(page: import("@playwright/test").Page) {
  await page.goto("/capture");
  await page
    .locator('section[aria-label="照片"] input[type="file"]')
    .setInputFiles(path.join(__dirname, "..", "fixtures", "sample-exif.jpg"));
  await expect(page.getByText("已保存，等待整理")).toBeVisible();
  await page.goto("/inbox");
  await page.getByLabel("事件标题").fill("出生那几天");
  await page.getByRole("button", { name: "确认进入时间轴" }).click();
  await expect(page.getByRole("heading", { name: "出生那几天" })).toBeVisible();
}

test("封存未到期：内容隐藏", async ({ page }) => {
  await ensureBootstrap(page);
  await createReferencedEvent(page);

  await page.goto("/capsules");
  await page.getByLabel("胶囊标题").fill("写给十八岁的你");
  await page.getByLabel("开启条件").selectOption("age");
  await page.getByLabel("开启年龄（岁）").fill("18");
  await page.getByRole("button", { name: "创建胶囊" }).click();

  await expect(page).toHaveURL(/\/capsules\//);
  await expect(page.getByRole("heading", { name: "写给十八岁的你" })).toBeVisible();

  // 放入一个已有的记忆事件
  await page.getByLabel("记忆事件").selectOption({ label: "出生那几天" });
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByRole("heading", { name: "记忆事件" })).toBeVisible();

  // 封存
  await page.getByRole("button", { name: "封存胶囊" }).click();
  await expect(page.getByText("内容已封存。", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("还没到开启的时间", { exact: false })).toBeVisible();
  // 未到期时开启按钮禁用
  const openBtn = page.getByRole("button", { name: "开启胶囊" });
  await expect(openBtn).toBeDisabled();

  // 列表显示已封存未到时间
  await page.goto("/capsules");
  const sealedCapsule = page.getByRole("link", { name: /写给十八岁的你/ });
  await expect(sealedCapsule.getByText("已封存", { exact: true })).toBeVisible();
  await expect(sealedCapsule.getByText(/大约还有/)).toBeVisible();
});

test("到期胶囊：可开启，内容重现", async ({ page }) => {
  await ensureLogin(page);
  await page.goto("/capsules");

  await page.getByLabel("胶囊标题").fill("出生百天的小礼物");
  await page.getByLabel("开启条件").selectOption("date");
  await page.getByLabel("开启日期").fill("2026-08-15"); // 已过
  await page.getByRole("button", { name: "创建胶囊" }).click();

  await expect(page).toHaveURL(/\/capsules\//);
  await page.getByLabel("记忆事件").selectOption({ label: "出生那几天" });
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "封存胶囊" }).click();

  // 到期 → 开启按钮可用
  const openBtn = page.getByRole("button", { name: "开启胶囊" });
  await expect(openBtn).toBeEnabled();
  await openBtn.click();

  await expect(page.getByText("已开启").first()).toBeVisible();
  // 开启后内容重现：事件区块出现
  await expect(page.getByRole("heading", { name: "记忆事件" })).toBeVisible();
});
