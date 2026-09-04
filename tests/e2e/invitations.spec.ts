import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { ADMIN, FAMILY, ensureBootstrap } from "./helpers";

test.describe.configure({ mode: "serial" });

const ORIGIN = "http://localhost:3121";
const DB_PATH = path.join(
  process.cwd(),
  "data",
  "e2e-invitations",
  "db",
  "capsule.sqlite",
);

const VIEWER = {
  displayName: "受邀查看者",
  email: "invited-viewer@example.com",
  password: "invited-viewer-password",
} as const;

const CONTRIBUTOR = {
  displayName: "受邀贡献者",
  email: "invited-contributor@example.com",
  password: "invited-contributor-password",
} as const;

type InvitedAccount = typeof VIEWER | typeof CONTRIBUTOR;
type InvitedRole = "viewer" | "contributor";

function readBinding(email: string): {
  role: string;
  familyId: string | null;
  familyName: string | null;
} {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  try {
    return db
      .prepare(
        `SELECT u.role AS role,
                u.family_id AS familyId,
                f.name AS familyName
           FROM user u
           LEFT JOIN family f ON f.id = u.family_id
          WHERE u.email = ?`,
      )
      .get(email) as {
      role: string;
      familyId: string | null;
      familyName: string | null;
    };
  } finally {
    db.close();
  }
}

async function createInvitation(
  adminPage: Page,
  role: InvitedRole,
  email: string,
): Promise<string> {
  await adminPage.goto("/settings/invitations");
  await expect(
    adminPage.getByRole("heading", { level: 1, name: "账号邀请" }),
  ).toBeVisible();
  await adminPage.getByLabel("账号角色").selectOption(role);
  await adminPage.getByLabel("限定邮箱（可选）").fill(email);
  await adminPage.getByRole("button", { name: "创建邀请链接" }).click();

  const result = adminPage.getByRole("status");
  await expect(result).toContainText("邀请已创建");
  const href = await result.getByRole("link").getAttribute("href");
  expect(href).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/);
  return href!;
}

async function acceptAndLogin(
  browser: Browser,
  invitePath: string,
  account: InvitedAccount,
  roleLabel: "查看者" | "贡献者",
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();

  const inviteResponse = await page.goto(invitePath);
  expect(inviteResponse?.status()).toBe(200);
  expect(inviteResponse?.headers()["cache-control"]).toContain("no-store");
  await expect(
    page.getByRole("heading", { level: 1, name: "接受账号邀请" }),
  ).toBeVisible();
  await expect(page.getByText(`「${FAMILY.name}」`, { exact: false })).toBeVisible();
  await expect(page.getByText(roleLabel, { exact: false }).first()).toBeVisible();

  await page.getByLabel("显示名称").fill(account.displayName);
  await page.getByLabel("登录邮箱").fill(account.email);
  await page.getByLabel("密码（至少 10 位）").fill(account.password);
  await page.getByLabel("确认密码").fill(account.password);
  await page.getByRole("button", { name: "接受邀请并创建账号" }).click();
  await expect(page).toHaveURL(/\/login\?invited=1$/);

  // The exact bearer link becomes unusable immediately after the first claim.
  await page.goto(invitePath);
  await expect(page.getByText("这个邀请已经使用")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "接受邀请并创建账号" }),
  ).toHaveCount(0);

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(account.email);
  await page.getByLabel("密码").fill(account.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("navigation", { name: "一级导航" })).toBeVisible();
  await expect(page.getByText(account.displayName, { exact: true }).first()).toBeVisible();
  return { context, page };
}

test("管理员邀请 viewer/contributor，受邀账号只获得各自家庭权限", async ({
  browser,
  page: adminPage,
}) => {
  test.setTimeout(90_000);
  await ensureBootstrap(adminPage);

  const publicSignup = await adminPage.request.post(
    "/api/auth/sign-up/email",
    {
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      data: {
        name: "公开注册攻击者",
        email: "public-signup-invitations-e2e@example.com",
        password: "public-signup-password",
      },
    },
  );
  expect(publicSignup.status()).toBe(403);

  const viewerInvite = await createInvitation(
    adminPage,
    "viewer",
    VIEWER.email,
  );
  const contributorInvite = await createInvitation(
    adminPage,
    "contributor",
    CONTRIBUTOR.email,
  );
  expect(contributorInvite).not.toBe(viewerInvite);

  const invitedContexts: BrowserContext[] = [];
  try {
    const viewer = await acceptAndLogin(
      browser,
      viewerInvite,
      VIEWER,
      "查看者",
    );
    invitedContexts.push(viewer.context);

    await viewer.page.goto("/settings");
    await expect(
      viewer.page.getByLabel("家庭", { exact: true }).getByText(FAMILY.name, { exact: true }),
    ).toBeVisible();
    await expect(
      viewer.page.getByText(VIEWER.displayName, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      viewer.page.getByRole("link", { name: "管理账号邀请" }),
    ).toHaveCount(0);
    await expect(
      viewer.page.getByRole("link", { name: /导出完整备份/ }),
    ).toHaveCount(0);

    await viewer.page.goto("/capture");
    await expect(viewer.page.getByText("当前账号是只读角色")).toBeVisible();
    await expect(viewer.page.locator("textarea[name='text']")).toHaveCount(0);
    await expect(
      viewer.page
        .getByRole("navigation", { name: "一级导航" })
        .getByRole("link", { name: "记录" }),
    ).toBeVisible();
    const deniedViewerUpload = await viewer.page.request.post(
      "/api/upload/image",
      {
        headers: { Origin: ORIGIN },
        multipart: {
          file: {
            name: "viewer-cannot-write.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.from("denied-before-file-parsing"),
          },
        },
      },
    );
    expect(deniedViewerUpload.status()).toBe(403);

    const contributor = await acceptAndLogin(
      browser,
      contributorInvite,
      CONTRIBUTOR,
      "贡献者",
    );
    invitedContexts.push(contributor.context);

    await contributor.page.goto("/settings");
    await expect(
      contributor.page.getByLabel("家庭", { exact: true }).getByText(FAMILY.name, { exact: true }),
    ).toBeVisible();
    await expect(
      contributor.page
        .getByText(CONTRIBUTOR.displayName, { exact: true })
        .first(),
    ).toBeVisible();
    await expect(
      contributor.page.getByRole("link", { name: "管理账号邀请" }),
    ).toHaveCount(0);
    await expect(
      contributor.page.getByRole("link", { name: /导出完整备份/ }),
    ).toHaveCount(0);

    await contributor.page.goto("/capture");
    await expect(
      contributor.page
        .getByRole("navigation", { name: "一级导航" })
        .getByRole("link", { name: "记录" }),
    ).toBeVisible();
    const note = "贡献者通过邀请写下的真实文字";
    await contributor.page.getByPlaceholder("今天想留下什么话？写给未来的她，或只是记下此刻。").fill(note);
    await contributor.page.getByRole("button", { name: "写一段话" }).click();
    await expect(contributor.page.getByText("已收进收件箱。")).toBeVisible();

    await contributor.page.goto("/inbox");
    await expect(contributor.page.getByText(note)).toBeVisible();
    await expect(
      contributor.page.getByText("整理与确认由管理员或编辑完成"),
    ).toBeVisible();
    await expect(
      contributor.page.getByRole("button", { name: "确认进入时间轴" }),
    ).toHaveCount(0);

    const adminBinding = readBinding(ADMIN.email);
    const viewerBinding = readBinding(VIEWER.email);
    const contributorBinding = readBinding(CONTRIBUTOR.email);
    expect(viewerBinding).toEqual({
      role: "viewer",
      familyId: adminBinding.familyId,
      familyName: FAMILY.name,
    });
    expect(contributorBinding).toEqual({
      role: "contributor",
      familyId: adminBinding.familyId,
      familyName: FAMILY.name,
    });
  } finally {
    await Promise.all(invitedContexts.map((context) => context.close()));
  }
});
