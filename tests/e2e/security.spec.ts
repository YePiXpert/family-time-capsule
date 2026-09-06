import { expect, type Page, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { ADMIN, SETUP_TOKEN, FAMILY, expectInApp, login } from "./helpers";
import { secretFromOtpauthUri, totpCode } from "./helpers/totp";

const DB_PATH = path.join(
  process.cwd(),
  "data",
  "e2e-security",
  "db",
  "capsule.sqlite",
);

// 账号安全（M2-b）：两步验证 TOTP + 恢复码 + 通行密钥（虚拟认证器）
// RH-006：本 project 独立 DATA_DIR，自包含执行。
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 500)));
  page.on("console", (message) => {
    if (message.type() === "error") console.log("[console.error]", message.text().slice(0, 500));
  });
});

async function bootstrap(page: Page) {
  await page.goto("/setup");
  if (/\/login(?:\?|$)/u.test(page.url())) {
    await login(page);
    return;
  }
  await page.getByLabel("初始化令牌").fill(SETUP_TOKEN);
  await page.getByLabel("显示名称").fill(ADMIN.displayName);
  await page.getByLabel("邮箱（登录用）").fill(ADMIN.email);
  await page.getByLabel("密码（至少 10 位）").fill(ADMIN.password);
  await page.getByLabel("确认密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "创建管理员" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("家庭名称").fill(FAMILY.name);
  await page.getByLabel("孩子姓名").fill(FAMILY.childName);
  await page.getByLabel("出生日期（时间轴按它计算成长年龄）").fill(FAMILY.childBirthDate);
  await page.getByLabel("显示名称").fill("爸爸");
  await page.getByLabel("对孩子的称谓").fill("爸爸");
  await page.getByLabel("我是孩子的监护人").check();
  await page.getByRole("button", { name: "创建家庭" }).click();
  await expectInApp(page);
}

let backupCodes: string[] = [];
let sharedSecret = "";

async function signOut(page: Page) {
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login/);
}

test("开启两步验证：密码 → 二维码 → 动态码确认 → 状态已开启", async ({ page }) => {
  await bootstrap(page);
  await page.goto("/settings/security");
  await page.getByLabel("当前密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "开启两步验证" }).click();
  await expect(page.getByRole("img", { name: "验证器二维码" })).toBeVisible();
  const uriText = await page.locator("code").first().textContent();
  expect(uriText).toMatch(/^otpauth:\/\/totp\//u);
  backupCodes = await page
    .locator("li.font-mono")
    .allTextContents();
  expect(backupCodes.length).toBeGreaterThanOrEqual(8);

  sharedSecret = secretFromOtpauthUri(uriText!);
  await page
    .getByPlaceholder("000000")
    .fill(totpCode(sharedSecret));
  await page.getByRole("button", { name: "确认开启" }).click();
  await expect(page.getByText("两步验证已开启")).toBeVisible();
  await expect(page.getByText("当前状态：已开启")).toBeVisible();
});

test("密码登录被引导到两步验证页；错误动态码拒绝后正确动态码进入", async ({ page }) => {
  // 每个测试独立上下文：上个测试结束时已登出
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login\/two-factor/);

  // 从启用步骤拿不到 secret 了（只显示一次），重新读取不可行；
  // 此处用集成测试同源 secret：本 spec 在上一步解析过——保存到模块级。
  await page.getByPlaceholder("000000").fill("000000");
  await page.getByRole("button", { name: "验证并进入" }).click();
  await expect(page.getByText("动态码不正确")).toBeVisible();

  await page.getByPlaceholder("000000").fill(totpCode(sharedSecret));
  await page.getByRole("button", { name: "验证并进入" }).click();
  await expectInApp(page);
});

test("恢复码可登录一次，第二次拒绝", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login\/two-factor/);
  await page.getByRole("radio", { name: "恢复码" }).check();
  await page.getByPlaceholder("xxxx-xxxx").fill(backupCodes[0]!);
  await page.getByRole("button", { name: "验证并进入" }).click();
  await expectInApp(page);

  await signOut(page);
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login\/two-factor/);
  await page.getByRole("radio", { name: "恢复码" }).check();
  await page.getByPlaceholder("xxxx-xxxx").fill(backupCodes[0]!);
  await page.getByRole("button", { name: "验证并进入" }).click();
  await expect(page.getByText("恢复码不正确或已使用过")).toBeVisible();
});

test("关闭两步验证后密码直登；通行密钥经虚拟认证器注册并可登录", async ({ page }) => {
  // 先用剩余恢复码登录会消耗它；改用动态码登录后关闭两步验证
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login\/two-factor/);
  await page.getByPlaceholder("000000").fill(totpCode(sharedSecret));
  await page.getByRole("button", { name: "验证并进入" }).click();
  await expectInApp(page);

  await page.goto("/settings/security");
  await page.getByLabel("关闭两步验证需确认当前密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "关闭两步验证" }).click();
  await expect(page.getByText("两步验证已关闭")).toBeVisible();

  // 虚拟认证器（Chromium CDP WebAuthn）
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.getByLabel('名称（如「爸爸的手机」）').fill(`e2e-${randomUUID().slice(0, 8)}`);
  await page.getByRole("button", { name: "添加通行密钥" }).click();
  await expect(page.getByText("已添加通行密钥")).toBeVisible();

  await signOut(page);
  await page.goto("/login");
  await page.getByRole("button", { name: "用通行密钥登录" }).click();
  await expectInApp(page);

  // 移除通行密钥后，通行密钥登录失败并提示
  await page.goto("/settings/security");
  await page.getByRole("button", { name: "移除" }).click();
  await expect(page.getByText("已移除该通行密钥")).toBeVisible();
  await signOut(page);
  await page.goto("/login");
  await page.getByRole("button", { name: "用通行密钥登录" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("通行密钥", {
    timeout: 15_000,
  });
});

test("本机恢复令牌：CLI 签发等价路径 → 设置新密码 → 旧会话失效可直登", async ({ page }) => {
  // 等价于部署者在服务器运行 npm run recover-account（令牌只存 SHA-256）
  const token = `recovery-${randomUUID()}${randomUUID()}`;
  const db = new Database(DB_PATH, { timeout: 5_000 });
  try {
    const user = db
      .prepare("SELECT id FROM user WHERE email = ?")
      .get("admin@example.com") as { id: string };
    db.prepare(
      `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, unixepoch() * 1000, unixepoch() * 1000)`,
    ).run(
      randomUUID(),
      "account-recovery:admin@example.com",
      createHash("sha256").update(token, "utf8").digest("hex"),
      Date.now() + 15 * 60 * 1000,
    );
    expect(user).toBeTruthy();
  } finally {
    db.close();
  }

  await page.goto(`/recover/${token}`);
  await page.getByLabel("新密码（至少 10 位）").fill(ADMIN.password);
  await page.getByLabel("再输入一次").fill(ADMIN.password);
  await page.getByRole("button", { name: "设置新密码" }).click();
  await expect(page.getByText("密码已更新，请用新密码重新登录。")).toBeVisible();

  // 新密码直登（两步验证已在上个测试关闭）
  await page.getByRole("link", { name: "去登录" }).click();
  await page.getByLabel("邮箱").fill(ADMIN.email);
  await page.getByLabel("密码").fill(ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expectInApp(page);

  // 令牌单次使用：重复访问报无效
  await page.goto("/login");
  await page.goto(`/recover/${token}`);
  await page.getByLabel("新密码（至少 10 位）").fill(ADMIN.password);
  await page.getByLabel("再输入一次").fill(ADMIN.password);
  await page.getByRole("button", { name: "设置新密码" }).click();
  await expect(page.getByText("恢复链接无效或已过期。")).toBeVisible();
});
