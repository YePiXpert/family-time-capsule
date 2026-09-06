import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-invite-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "invite-setup-token";
process.env.AUTH_SECRET = "invite-test-secret-with-sufficient-entropy";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { session, user } = await import("@/db/schema/auth");
const { family, person } = await import("@/db/schema/family");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, addPerson } = await import("@/lib/family/service");
const { GET: previewGet } = await import("@/app/api/invitations/preview/route");
const { POST: acceptPost } = await import("@/app/api/invitations/accept/route");
const { POST: invitationPost } = await import(
  "@/app/api/mobile/v1/invitations/route"
);
const { GET: meGet } = await import("@/app/api/mobile/v1/me/route");

const ADMIN = {
  token: "invite-setup-token",
  displayName: "妈妈",
  email: "admin@invite.example.com",
  password: "a-long-invite-password",
};

const ONBOARDING = {
  familyName: "小满家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2026-09-02",
  selfDisplayName: "妈妈",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
};

let adminToken = "";
let familyId = "";
let createdToken = "";

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
  const token = `invite-${randomUUID()}`;
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

function bearer(url: string, token: string | null): Request {
  return new Request(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function jsonPost(url: string, token: string | null, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("App 邀请闭环（创建 → 预览 → 接受）", () => {
  it("初始化管理员并建立家庭", async () => {
    expect((await performSetup(ADMIN)).ok).toBe(true);
    const { userId } = await createSessionForEmail(ADMIN.email.toLowerCase());
    const result = await completeOnboarding(userId, ONBOARDING);
    expect(result.ok).toBe(true);
    if (result.ok) familyId = result.familyId;
    adminToken = (await createSessionForEmail(ADMIN.email.toLowerCase())).token;
  });

  it("管理员创建邀请：一次性 token 只出现一次；非法输入被拒绝", async () => {
    const response = await invitationPost(
      jsonPost(
        "http://localhost/api/mobile/v1/invitations",
        adminToken,
        { role: "contributor", expiresInDays: 7 },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      invitePath: string;
      invitationId: string;
    };
    expect(body.token.length).toBeGreaterThanOrEqual(32);
    expect(body.invitePath).toBe(`/invite/${body.token}`);

    const bad = await invitationPost(
      jsonPost(
        "http://localhost/api/mobile/v1/invitations",
        adminToken,
        { role: "boss", expiresInDays: 7 },
      ),
    );
    expect(bad.status).toBe(400);

    // 保存 token 供后续用例使用
    createdToken = body.token;
  });

  it("公开预览只读：显示有限信息，不消耗邀请", async () => {
    const response = await previewGet(
      new Request(
        `http://localhost/api/invitations/preview?token=${createdToken}`,
      ),
    );
    expect(response.status).toBe(200);
    const preview = (await response.json()) as {
      status: string;
      familyName: string;
      role: string;
    };
    expect(preview.status).toBe("active");
    expect(preview.familyName).toBe(ONBOARDING.familyName);
    expect(preview.role).toBe("contributor");
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain(ADMIN.email);

    const invalid = await previewGet(
      new Request("http://localhost/api/invitations/preview?token=not-a-token"),
    );
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({ status: "invalid" });
  });

  it("受邀请人接受邀请后自动绑定同一家庭；重复接受失效", async () => {
    const member = {
      token: createdToken,
      displayName: "爸爸",
      email: "dad@invite.example.com",
      password: "another-long-password",
    };
    const response = await acceptPost(
      jsonPost("http://localhost/api/invitations/accept", null, member),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const again = await acceptPost(
      jsonPost("http://localhost/api/invitations/accept", null, {
        ...member,
        email: "someone-else@invite.example.com",
      }),
    );
    expect(again.status).toBe(403);

    const { token: memberSession } = await createSessionForEmail(member.email);
    const me = await meGet(
      bearer("http://localhost/api/mobile/v1/me", memberSession),
    );
    const meBody = (await me.json()) as {
      status: string;
      family: { id: string };
      account: { role: string };
    };
    expect(meBody.status).toBe("ready");
    expect(meBody.family.id).toBe(familyId);
    expect(meBody.account.role).toBe("contributor");
  });

  it("同邮箱已有账号时引导登录，不自动搬迁；非 admin 不能创建邀请", async () => {
    const response = await invitationPost(
      jsonPost(
        "http://localhost/api/mobile/v1/invitations",
        adminToken,
        { role: "viewer", expiresInDays: 3 },
      ),
    );
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };

    const existing = await acceptPost(
      jsonPost("http://localhost/api/invitations/accept", null, {
        token,
        displayName: "重复邮箱",
        email: ADMIN.email.toLowerCase(),
        password: "another-long-password",
      }),
    );
    expect(existing.status).toBe(409);
    expect(await existing.json()).toEqual({ error: "account_exists" });

    // viewer 角色成员不能创建邀请
    const db = getDb();
    const now = new Date();
    const viewerId = randomUUID();
    await db.insert(user).values({
      id: viewerId,
      name: "外婆",
      email: "grandma@invite.example.com",
      emailVerified: true,
      role: "viewer",
      familyId,
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
    const forbidden = await invitationPost(
      jsonPost(
        "http://localhost/api/mobile/v1/invitations",
        viewerToken,
        { role: "contributor", expiresInDays: 7 },
      ),
    );
    expect(forbidden.status).toBe(403);

    // 未认证更不能创建
    const anonymous = await invitationPost(
      jsonPost(
        "http://localhost/api/mobile/v1/invitations",
        null,
        { role: "contributor", expiresInDays: 7 },
      ),
    );
    expect(anonymous.status).toBe(401);
  });

  it("人物绑定邀请：接受后新账号关联到指定 Person", async () => {
    const personResult = await addPerson(familyId, {
      displayName: "外公",
      relationToChild: "外公",
    });
    expect(personResult.ok).toBe(true);
    if (!personResult.ok) return;
    const response = await invitationPost(
      jsonPost("http://localhost/api/mobile/v1/invitations", adminToken, {
        role: "contributor",
        expiresInDays: 5,
        personId: personResult.personId,
      }),
    );
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };

    const accept = await acceptPost(
      jsonPost("http://localhost/api/invitations/accept", null, {
        token,
        displayName: "外公",
        email: "grandpa@invite.example.com",
        password: "another-long-password",
      }),
    );
    expect(accept.status).toBe(200);

    const { userId } = await createSessionForEmail("grandpa@invite.example.com");
    const bound = await getDb()
      .select({ personId: user.personId, familyId: user.familyId })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    expect(bound[0]?.personId).toBe(personResult.personId);
    expect(bound[0]?.familyId).toBe(familyId);
    // 人物绑定后不能再被重复邀请
    const occupied = await invitationPost(
      jsonPost("http://localhost/api/mobile/v1/invitations", adminToken, {
        role: "contributor",
        expiresInDays: 5,
        personId: personResult.personId,
      }),
    );
    expect(occupied.status).toBe(400);
  });

  it("访客投递 token 不能用于注册账号", async () => {
    // 投递箱使用不同形态的低熵口令；邀请 token 校验要求 256-bit base64url。
    const response = await acceptPost(
      jsonPost("http://localhost/api/invitations/accept", null, {
        token: "guest-dropbox-short-code",
        displayName: "访客",
        email: "guest@invite.example.com",
        password: "another-long-password",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
    const created = await getDb()
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "guest@invite.example.com"))
      .limit(1);
    expect(created).toHaveLength(0);
  });
});
