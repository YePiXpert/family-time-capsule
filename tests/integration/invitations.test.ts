import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-invitations-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "invitation-setup-token";
process.env.AUTH_SECRET = "invitation-test-secret-0123456789";
process.env.AUTH_SIGNIN_RATE_LIMIT_MAX = "100";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { account, session, user: userTable } = await import("@/db/schema/auth");
const { auditLog } = await import("@/db/schema/audit");
const { family, person } = await import("@/db/schema/family");
const { familyInvitation } = await import("@/db/schema/invitation");
const { getAuth } = await import("@/lib/auth/auth");
const { performSetup } = await import("@/lib/auth/setup");
const {
  addPerson,
  completeOnboarding,
  getUserBinding,
  listPeople,
} = await import("@/lib/family/service");
const {
  acceptFamilyInvitation,
  createFamilyInvitation,
  hashInvitationToken,
  inspectInvitationToken,
  INVITATION_AUDIT_KINDS,
  reconcileFamilyInvitationProvisioning,
  revokeFamilyInvitation,
} = await import("@/lib/invitations/service");

const setup = await performSetup({
  token: "invitation-setup-token",
  displayName: "管理员",
  email: "admin-invitations@example.com",
  password: "admin-password-long-enough",
});
if (!setup.ok) throw new Error(`invitation setup failed: ${setup.error}`);
const admin = (
  await getDb()
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, "admin-invitations@example.com"))
)[0];
const onboarding = await completeOnboarding(admin.id, {
  familyName: "邀请测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2020-05-01",
  selfDisplayName: "管理员",
  selfRelationToChild: "爸爸",
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${onboarding.error}`);
const familyId = onboarding.familyId;
const grandmaResult = await addPerson(familyId, {
  displayName: "外婆",
  relationToChild: "外婆",
});
if (!grandmaResult.ok) throw new Error("failed to create invitation Person");
const grandmaId = grandmaResult.personId;

async function createInvite(
  suffix: string,
  overrides: Partial<{
    role: "admin" | "editor" | "contributor" | "viewer";
    email: string | null;
    personId: string | null;
    expiresAt: Date;
    actorUserId: string;
    familyId: string;
  }> = {},
) {
  return createFamilyInvitation({
    familyId: overrides.familyId ?? familyId,
    actorUserId: overrides.actorUserId ?? admin.id,
    role: overrides.role ?? "viewer",
    email:
      overrides.email === undefined
        ? `invite-${suffix}@example.com`
        : overrides.email,
    personId: overrides.personId ?? null,
    expiresAt:
      overrides.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
}

describe.sequential("invitation-only accounts", () => {
  it("stores only a SHA-256 token hash and writes a secret-free creation audit", async () => {
    const result = await createInvite("hash-only", { email: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = (
      await getDb()
        .select()
        .from(familyInvitation)
        .where(eq(familyInvitation.id, result.invitationId))
    )[0];
    expect(row.tokenHash).toBe(hashInvitationToken(result.token));
    expect(row.tokenHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(result.token);

    const audits = await getDb()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.familyId, familyId),
          eq(auditLog.kind, INVITATION_AUDIT_KINDS.created),
        ),
      );
    const audit = audits.find((entry) =>
      entry.detailJson.includes(result.invitationId),
    );
    expect(audit).toBeTruthy();
    expect(audit?.detailJson).not.toContain(result.token);
    expect(audit?.detailJson).not.toContain(row.tokenHash);
  });

  it("rejects overlong or control-character invitation emails", async () => {
    await expect(
      createInvite("email-too-long", {
        email: `${"a".repeat(245)}@example.com`,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_input" });
    await expect(
      createInvite("email-control", {
        email: "unsafe\u0000@example.com",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects expired and revoked invitations without consuming them", async () => {
    const expired = await createInvite("expired");
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    await getDb()
      .update(familyInvitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(familyInvitation.id, expired.invitationId));
    expect((await inspectInvitationToken(expired.token)).status).toBe("expired");
    await expect(
      acceptFamilyInvitation({
        token: expired.token,
        displayName: "过期用户",
        email: "invite-expired@example.com",
        password: "a-long-password-for-expired",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_or_unavailable" });

    const revoked = await createInvite("revoked");
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    await expect(
      revokeFamilyInvitation({
        familyId,
        actorUserId: admin.id,
        invitationId: revoked.invitationId,
      }),
    ).resolves.toEqual({ ok: true });
    expect((await inspectInvitationToken(revoked.token)).status).toBe("revoked");
    await expect(
      acceptFamilyInvitation({
        token: revoked.token,
        displayName: "撤销用户",
        email: "invite-revoked@example.com",
        password: "a-long-password-for-revoked",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_or_unavailable" });
  });

  it("creates one correctly bound Better Auth credential and makes the token single-use", async () => {
    const plaintext = "editor-password-never-stored";
    const invitation = await createInvite("bound", {
      role: "editor",
      email: "Bound.Editor@Example.com",
      personId: grandmaId,
    });
    expect(invitation.ok).toBe(true);
    if (!invitation.ok) return;

    const accepted = await acceptFamilyInvitation({
      token: invitation.token,
      displayName: "外婆账号",
      email: "bound.editor@example.com",
      password: plaintext,
    });
    if (!accepted.ok) throw new Error(`accept failed: ${accepted.error}`);
    expect(accepted).toMatchObject({ ok: true });

    const created = (
      await getDb()
        .select()
        .from(userTable)
        .where(eq(userTable.id, accepted.userId))
    )[0];
    expect(created).toMatchObject({
      familyId,
      personId: grandmaId,
      role: "editor",
      email: "bound.editor@example.com",
    });
    const credential = (
      await getDb()
        .select()
        .from(account)
        .where(eq(account.userId, accepted.userId))
    )[0];
    expect(credential.providerId).toBe("credential");
    expect(credential.password).not.toBe(plaintext);
    expect(credential.password).not.toContain(plaintext);

    const used = (
      await getDb()
        .select()
        .from(familyInvitation)
        .where(eq(familyInvitation.id, invitation.invitationId))
    )[0];
    expect(used.usedByUserId).toBe(accepted.userId);
    expect(used.usedAt).toBeInstanceOf(Date);
    expect(used.claimNonce).toBeNull();
    expect(used.claimExpiresAt).toBeNull();
    expect(used.provisionedUserId).toBeNull();
    expect(
      await getDb()
        .select()
        .from(session)
        .where(eq(session.userId, accepted.userId)),
    ).toHaveLength(0);

    await expect(
      acceptFamilyInvitation({
        token: invitation.token,
        displayName: "第二个人",
        email: "somebody-else@example.com",
        password: "another-long-password",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_or_unavailable" });
  });

  it("allows at most one success across 20 concurrent acceptance attempts", async () => {
    const invitation = await createInvite("concurrent", {
      role: "contributor",
      email: null,
    });
    expect(invitation.ok).toBe(true);
    if (!invitation.ok) return;

    const attemptEmails = Array.from(
      { length: 20 },
      (_, index) => `concurrent-${index}@example.com`,
    );
    const attempts = await Promise.all(
      attemptEmails.map((email, index) =>
        acceptFamilyInvitation({
          token: invitation.token,
          displayName: `并发用户 ${index}`,
          email,
          password: "concurrent-password-long",
        }),
      ),
    );
    expect(attempts.filter((result) => result.ok)).toHaveLength(1);
    const created = await getDb()
      .select()
      .from(userTable)
      .where(inArray(userTable.email, attemptEmails));
    expect(created).toHaveLength(1);
    expect(created[0].role).toBe("contributor");
    expect(created[0].familyId).toBe(familyId);
  }, 20_000);

  it("keeps the real HTTP sign-up endpoint closed after invitations exist", async () => {
    const before = (
      await getDb().select({ value: sql<number>`count(*)` }).from(userTable)
    )[0].value;
    const response = await getAuth().handler(
      new Request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          name: "攻击者",
          email: "public-signup-attacker@example.com",
          password: "attacker-password-long",
        }),
      }),
    );
    expect(response.status).toBe(403);
    const after = (
      await getDb().select({ value: sql<number>`count(*)` }).from(userTable)
    )[0].value;
    expect(after).toBe(before);
  });

  it("rejects non-admin creation and cross-family Person binding", async () => {
    const viewerId = randomUUID();
    const otherFamilyId = randomUUID();
    const otherPersonId = randomUUID();
    const now = new Date();
    await getDb().insert(family).values({
      id: otherFamilyId,
      name: "另一个家庭",
      timezone: "Asia/Shanghai",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(person).values({
      id: otherPersonId,
      familyId: otherFamilyId,
      displayName: "别家成员",
      isChild: false,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(userTable).values({
      id: viewerId,
      name: "只读成员",
      email: "viewer-no-invite-right@example.com",
      emailVerified: false,
      role: "viewer",
      familyId,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      createInvite("viewer-forbidden", { actorUserId: viewerId }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(
      createInvite("foreign-person", { personId: otherPersonId }),
    ).resolves.toEqual({ ok: false, error: "person_unavailable" });

    // Defense in depth: even a legacy/corrupt row whose Person belongs to a
    // different family cannot create or bind an account.
    const rawToken = randomBytes(32).toString("base64url");
    const corruptInvitationId = randomUUID();
    await getDb().insert(familyInvitation).values({
      id: corruptInvitationId,
      tokenHash: hashInvitationToken(rawToken),
      familyId,
      role: "viewer",
      email: "corrupt-cross-family@example.com",
      personId: otherPersonId,
      expiresAt: new Date(Date.now() + 60_000),
      createdByUserId: admin.id,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      acceptFamilyInvitation({
        token: rawToken,
        displayName: "不能绑定",
        email: "corrupt-cross-family@example.com",
        password: "cross-family-password",
      }),
    ).resolves.toEqual({ ok: false, error: "person_unavailable" });
    const corrupt = (
      await getDb()
        .select()
        .from(familyInvitation)
        .where(eq(familyInvitation.id, corruptInvitationId))
    )[0];
    expect(corrupt.claimNonce).toBeNull();
  });

  it("releases the atomic claim and leaves no new user when acceptance fails", async () => {
    const before = (
      await getDb().select({ value: sql<number>`count(*)` }).from(userTable)
    )[0].value;
    const invitation = await createInvite("duplicate", {
      email: "admin-invitations@example.com",
    });
    expect(invitation.ok).toBe(true);
    if (!invitation.ok) return;
    await expect(
      acceptFamilyInvitation({
        token: invitation.token,
        displayName: "重复账号",
        email: "admin-invitations@example.com",
        password: "duplicate-account-password",
      }),
    ).resolves.toEqual({ ok: false, error: "account_exists" });

    const after = (
      await getDb().select({ value: sql<number>`count(*)` }).from(userTable)
    )[0].value;
    expect(after).toBe(before);
    const row = (
      await getDb()
        .select()
        .from(familyInvitation)
        .where(eq(familyInvitation.id, invitation.invitationId))
    )[0];
    expect(row.claimNonce).toBeNull();
    expect(row.claimExpiresAt).toBeNull();
    expect(row.usedAt).toBeNull();
    expect(row.usedByUserId).toBeNull();
  });

  it("removes only the newly provisioned user when atomic finalization fails", async () => {
    const invitation = await createInvite("forced-finalize-failure", {
      role: "editor",
      email: "forced-finalize-failure@example.com",
    });
    expect(invitation.ok).toBe(true);
    if (!invitation.ok) return;
    const before = (
      await getDb().select({ value: sql<number>`count(*)` }).from(userTable)
    )[0].value;

    getDb().run(sql.raw(`
      CREATE TRIGGER fail_invitation_accept_audit
      BEFORE INSERT ON audit_log
      WHEN NEW.kind = 'invitation.accepted'
      BEGIN
        SELECT RAISE(ABORT, 'forced invitation finalization failure');
      END
    `));
    try {
      await expect(
        acceptFamilyInvitation({
          token: invitation.token,
          displayName: "应被清理的账号",
          email: "forced-finalize-failure@example.com",
          password: "forced-finalize-password",
        }),
      ).resolves.toEqual({ ok: false, error: "account_creation_failed" });
    } finally {
      getDb().run(sql.raw("DROP TRIGGER IF EXISTS fail_invitation_accept_audit"));
    }

    const after = (
      await getDb().select({ value: sql<number>`count(*)` }).from(userTable)
    )[0].value;
    expect(after).toBe(before);
    expect(
      await getDb()
        .select()
        .from(userTable)
        .where(eq(userTable.email, "forced-finalize-failure@example.com")),
    ).toHaveLength(0);
    const row = (
      await getDb()
        .select()
        .from(familyInvitation)
        .where(eq(familyInvitation.id, invitation.invitationId))
    )[0];
    expect(row.claimNonce).toBeNull();
    expect(row.claimExpiresAt).toBeNull();
    expect(row.usedAt).toBeNull();
    expect(row.provisionedUserId).toEqual(expect.any(String));
  });

  it("reclaims an expired crash orphan before provisioning a fresh account", async () => {
    const invitation = await createInvite("crash-recovery", {
      role: "editor",
      email: "crash-recovery@example.com",
    });
    expect(invitation.ok).toBe(true);
    if (!invitation.ok) return;

    const orphanUserId = randomUUID();
    const orphanAccountId = randomUUID();
    const orphanSessionId = randomUUID();
    const now = new Date();
    await getDb().insert(userTable).values({
      id: orphanUserId,
      name: "未完成的邀请账号",
      email: "crash-recovery@example.com",
      emailVerified: false,
      role: "viewer",
      familyId: null,
      personId: null,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(account).values({
      id: orphanAccountId,
      userId: orphanUserId,
      accountId: orphanUserId,
      providerId: "credential",
      password: "crash-placeholder-hash",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(session).values({
      id: orphanSessionId,
      token: `orphan-${randomUUID()}`,
      userId: orphanUserId,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .update(familyInvitation)
      .set({
        claimNonce: randomBytes(16).toString("hex"),
        claimExpiresAt: new Date(Date.now() - 1000),
        provisionedUserId: orphanUserId,
      })
      .where(eq(familyInvitation.id, invitation.invitationId));

    // The simulated crash account is authenticated but fail-closed: it has no
    // family/Person binding and only the minimum viewer role.
    expect(
      await getDb()
        .select({
          role: userTable.role,
          familyId: userTable.familyId,
          personId: userTable.personId,
        })
        .from(userTable)
        .where(eq(userTable.id, orphanUserId)),
    ).toEqual([{ role: "viewer", familyId: null, personId: null }]);

    const recovered = await acceptFamilyInvitation({
      token: invitation.token,
      displayName: "恢复后的账号",
      email: "crash-recovery@example.com",
      password: "fresh-password-after-crash",
    });
    if (!recovered.ok) throw new Error(`recovery failed: ${recovered.error}`);
    expect(recovered).toMatchObject({ ok: true });
    // Reusing the durable reserved id is the fencing mechanism: an old writer
    // and the retry cannot both insert different users after lease expiry.
    expect(recovered.userId).toBe(orphanUserId);
    expect(
      await getDb()
        .select()
        .from(account)
        .where(eq(account.id, orphanAccountId)),
    ).toHaveLength(0);
    expect(
      await getDb()
        .select()
        .from(session)
        .where(eq(session.id, orphanSessionId)),
    ).toHaveLength(0);
    expect(
      await getDb()
        .select({
          role: userTable.role,
          familyId: userTable.familyId,
          personId: userTable.personId,
        })
        .from(userTable)
        .where(eq(userTable.id, recovered.userId)),
    ).toEqual([{ role: "editor", familyId, personId: null }]);
  });

  it("enforces a bound email without burning the invitation claim", async () => {
    const invitation = await createInvite("email-bound", {
      email: "right-address@example.com",
    });
    expect(invitation.ok).toBe(true);
    if (!invitation.ok) return;
    await expect(
      acceptFamilyInvitation({
        token: invitation.token,
        displayName: "邮箱错误",
        email: "wrong-address@example.com",
        password: "wrong-address-password",
      }),
    ).resolves.toEqual({ ok: false, error: "email_mismatch" });
    const row = (
      await getDb()
        .select()
        .from(familyInvitation)
        .where(eq(familyInvitation.id, invitation.invitationId))
    )[0];
    expect(row.claimNonce).toBeNull();
    expect(row.usedAt).toBeNull();
  });

  it("reconciles a late provisional INSERT after terminal revocation", async () => {
    const invitation = await createInvite("revoked-late-writer", {
      email: "revoked-late-writer@example.com",
    });
    expect(invitation.ok).toBe(true);
    if (!invitation.ok) return;
    const reservedUserId = randomUUID();
    const now = new Date();
    await getDb()
      .update(familyInvitation)
      .set({
        claimNonce: randomBytes(16).toString("hex"),
        claimExpiresAt: new Date(Date.now() + 60_000),
        provisionedUserId: reservedUserId,
      })
      .where(eq(familyInvitation.id, invitation.invitationId));
    await expect(
      revokeFamilyInvitation({
        familyId,
        actorUserId: admin.id,
        invitationId: invitation.invitationId,
      }),
    ).resolves.toEqual({ ok: true });

    // Simulate the old process resuming after revoke deleted the then-current
    // provisional row. The tombstone still tracks the same stable primary key.
    await getDb().insert(userTable).values({
      id: reservedUserId,
      name: "迟到的 provisional",
      email: "revoked-late-writer@example.com",
      emailVerified: false,
      role: "viewer",
      familyId: null,
      personId: null,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(session).values({
      id: randomUUID(),
      token: `late-${randomUUID()}`,
      userId: reservedUserId,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: now,
      updatedAt: now,
    });

    await reconcileFamilyInvitationProvisioning(familyId, admin.id);
    expect(
      await getDb()
        .select()
        .from(userTable)
        .where(eq(userTable.id, reservedUserId)),
    ).toHaveLength(0);
    const tombstone = (
      await getDb()
        .select()
        .from(familyInvitation)
        .where(eq(familyInvitation.id, invitation.invitationId))
    )[0];
    expect(tombstone.revokedAt).toBeInstanceOf(Date);
    expect(tombstone.provisionedUserId).toBe(reservedUserId);
  });

  it("reaps an expired invitation orphan while preserving its fencing tombstone", async () => {
    const invitation = await createInvite("expired-terminal-orphan", {
      email: "expired-terminal-orphan@example.com",
    });
    expect(invitation.ok).toBe(true);
    if (!invitation.ok) return;
    const reservedUserId = randomUUID();
    const now = new Date();
    await getDb().insert(userTable).values({
      id: reservedUserId,
      name: "过期邀请孤儿",
      email: "expired-terminal-orphan@example.com",
      emailVerified: false,
      role: "viewer",
      familyId: null,
      personId: null,
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .update(familyInvitation)
      .set({
        expiresAt: new Date(Date.now() - 1000),
        provisionedUserId: reservedUserId,
      })
      .where(eq(familyInvitation.id, invitation.invitationId));

    await expect(
      reconcileFamilyInvitationProvisioning(familyId, admin.id),
    ).resolves.toBe(true);
    expect(
      await getDb()
        .select()
        .from(userTable)
        .where(eq(userTable.id, reservedUserId)),
    ).toHaveLength(0);
    const tombstone = (
      await getDb()
        .select()
        .from(familyInvitation)
        .where(eq(familyInvitation.id, invitation.invitationId))
    )[0];
    expect(tombstone.expiresAt.getTime()).toBeLessThan(Date.now());
    expect(tombstone.provisionedUserId).toBe(reservedUserId);
  });

  it("keeps Person and User distinct after invited account creation", async () => {
    const binding = await getUserBinding(admin.id);
    const people = await listPeople(binding.familyId!);
    expect(people.find((member) => member.id === grandmaId)).toBeTruthy();
    const users = await getDb()
      .select({ id: userTable.id, personId: userTable.personId })
      .from(userTable)
      .where(eq(userTable.personId, grandmaId));
    expect(users).toHaveLength(1);
    expect(users[0].id).not.toBe(grandmaId);
  });

  it("enforces one login account per non-null Person at the database boundary", async () => {
    let failure: unknown;
    try {
      await getDb().insert(userTable).values({
        id: randomUUID(),
        name: "重复的 Person 账号",
        email: "duplicate-person-binding@example.com",
        emailVerified: false,
        role: "viewer",
        familyId,
        personId: grandmaId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      failure = error;
    }
    const sqliteCode =
      (failure as { code?: string } | undefined)?.code ??
      (failure as { cause?: { code?: string } } | undefined)?.cause?.code;
    expect(sqliteCode).toBe("SQLITE_CONSTRAINT_UNIQUE");
  });
});
