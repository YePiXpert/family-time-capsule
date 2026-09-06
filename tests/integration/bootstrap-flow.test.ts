import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

// 环境必须在动态导入前设置（lib/paths 在模块加载时读取 DATA_DIR）
const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-bootstrap-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "bootstrap-setup-token";
process.env.AUTH_SECRET = "bootstrap-test-secret-with-sufficient-entropy";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { session, user } = await import("@/db/schema/auth");
const { family } = await import("@/db/schema/family");
const { countUsers } = await import("@/lib/auth/setup");
const { GET: bootstrapGet } = await import("@/app/api/bootstrap/route");
const { POST: bootstrapSetupPost } = await import(
  "@/app/api/bootstrap/setup/route"
);
const { GET: meGet } = await import("@/app/api/mobile/v1/me/route");
const { POST: onboardingPost } = await import(
  "@/app/api/mobile/v1/onboarding/route"
);

const ADMIN = {
  token: "bootstrap-setup-token",
  displayName: "妈妈",
  email: "Bootstrap@Example.com",
  password: "a-long-bootstrap-password",
};

const ONBOARDING = {
  familyName: "河边的小满家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-09-02",
  selfDisplayName: "妈妈",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
};

function setupRequest(body: unknown): Request {
  return new Request("http://localhost/api/bootstrap/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function bearerRequest(url: string, token: string | null): Request {
  return new Request(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function jsonPost(url: string, token: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function createSessionForEmail(
  email: string,
): Promise<{ token: string; userId: string }> {
  const db = getDb();
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  const userId = rows[0]?.id;
  if (!userId) throw new Error(`user not found: ${email}`);
  const now = new Date();
  const token = `bootstrap-${randomUUID()}`;
  await db.insert(session).values({
    id: randomUUID(),
    token,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
  return { token, userId };
}

describe("GET /api/bootstrap（实例识别）", () => {
  it("新实例返回可初始化状态与稳定 instanceId，不泄露内部信息", async () => {
    const response = await bootstrapGet();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.product).toBe("family-time-capsule");
    expect(body.apiVersion).toBe(1);
    expect(body.instanceId).toMatch(/^[0-9a-f]{32}$/);
    expect((body.setup as Record<string, unknown>).state).toBe("available");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(ADMIN.email);
    expect(serialized).not.toContain(ADMIN.token);

    const again = await (await bootstrapGet()).json();
    expect((again as Record<string, unknown>).instanceId).toBe(
      body.instanceId,
    );
  });
});

describe("POST /api/bootstrap/setup（App 内初始化）", () => {
  it("错误令牌 → 403 invalid_token，不创建用户", async () => {
    const response = await bootstrapSetupPost(
      setupRequest({ ...ADMIN, token: "wrong" }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(await countUsers()).toBe(0);
  });

  it("非法输入（短密码）→ 400", async () => {
    const response = await bootstrapSetupPost(
      setupRequest({ ...ADMIN, password: "short" }),
    );
    expect(response.status).toBe(400);
    expect(await countUsers()).toBe(0);
  });

  it("正确初始化 → 200；此后 setup 关闭，bootstrap 显示 completed", async () => {
    const response = await bootstrapSetupPost(setupRequest(ADMIN));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await countUsers()).toBe(1);

    const repeat = await bootstrapSetupPost(setupRequest(ADMIN));
    expect(repeat.status).toBe(409);
    expect(await repeat.json()).toEqual({ error: "already_initialized" });

    const bootstrap = (await (await bootstrapGet()).json()) as {
      setup: { state: string };
    };
    expect(bootstrap.setup).toMatchObject({ state: "completed" });
  });
});

describe("GET /api/mobile/v1/me（身份与家庭状态分离）", () => {
  it("无凭据 → 401 unauthenticated", async () => {
    const response = await meGet(
      bearerRequest("http://localhost/api/mobile/v1/me", null),
    );
    expect(response.status).toBe(401);
  });

  it("账号已建立但未建家庭 → needsOnboarding（不是 401）", async () => {
    const { token } = await createSessionForEmail(
      ADMIN.email.toLowerCase(),
    );
    const response = await meGet(
      bearerRequest("http://localhost/api/mobile/v1/me", token),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("needsOnboarding");
    expect((body.user as Record<string, unknown>).email).toBe(
      ADMIN.email.toLowerCase(),
    );
  });

  it("被禁用账号的会话被触发器回收 → 401（App 端引导重新登录，登录时提示账号不可用）", async () => {
    const { token, userId } = await createSessionForEmail(
      ADMIN.email.toLowerCase(),
    );
    await getDb()
      .update(user)
      .set({ disabledAt: new Date() })
      .where(eq(user.id, userId));
    try {
      const response = await meGet(
        bearerRequest("http://localhost/api/mobile/v1/me", token),
      );
      expect(response.status).toBe(401);
    } finally {
      await getDb()
        .update(user)
        .set({ disabledAt: null })
        .where(eq(user.id, userId));
    }
  });
});

describe("POST /api/mobile/v1/onboarding（App 内建立家庭）", () => {
  it("无凭据 → 401", async () => {
    const response = await onboardingPost(
      new Request("http://localhost/api/mobile/v1/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ONBOARDING),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("非 family:manage 角色不能建家庭 → 403", async () => {
    const db = getDb();
    const now = new Date();
    const viewerId = randomUUID();
    await db.insert(user).values({
      id: viewerId,
      name: "访客账号",
      email: "unbound-viewer@example.com",
      emailVerified: true,
      role: "viewer",
      familyId: null,
      personId: null,
      createdAt: now,
      updatedAt: now,
    });
    const viewerToken = `viewer-${randomUUID()}`;
    await db.insert(session).values({
      id: randomUUID(),
      token: viewerToken,
      userId: viewerId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const response = await onboardingPost(
      jsonPost(
        "http://localhost/api/mobile/v1/onboarding",
        viewerToken,
        ONBOARDING,
      ),
    );
    expect(response.status).toBe(403);
  });

  it("非法输入 → 400，不创建家庭（在成功建家庭之前验证）", async () => {
    const admin = await createSessionForEmail(ADMIN.email.toLowerCase());
    const response = await onboardingPost(
      jsonPost(
        "http://localhost/api/mobile/v1/onboarding",
        admin.token,
        { ...ONBOARDING, timezone: "Not/A_Zone" },
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
    const families = await getDb().select({ id: family.id }).from(family);
    expect(families).toHaveLength(0);
  });

  it("管理员建立家庭 → ready；重复提交 → 409 且仍只有一个家庭", async () => {
    const { token } = await createSessionForEmail(ADMIN.email.toLowerCase());
    const response = await onboardingPost(
      jsonPost(
        "http://localhost/api/mobile/v1/onboarding",
        token,
        ONBOARDING,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.familyId).toBe("string");

    const repeat = await onboardingPost(
      jsonPost(
        "http://localhost/api/mobile/v1/onboarding",
        token,
        { ...ONBOARDING, familyName: "第二个家庭" },
      ),
    );
    expect(repeat.status).toBe(409);
    const families = await getDb().select({ id: family.id }).from(family);
    expect(families).toHaveLength(1);

    const me = await meGet(
      bearerRequest("http://localhost/api/mobile/v1/me", token),
    );
    const meBody = (await me.json()) as {
      status: string;
      family: { id: string; name: string; timezone: string };
      account: { role: string };
    };
    expect(meBody.status).toBe("ready");
    expect(meBody.family.id).toBe(body.familyId);
    expect(meBody.family.name).toBe(ONBOARDING.familyName);
    expect(meBody.family.timezone).toBe(ONBOARDING.timezone);
    expect(meBody.account.role).toBe("owner");
  });
});
