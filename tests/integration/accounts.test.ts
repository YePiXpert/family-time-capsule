import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-accounts-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "accounts-setup-token";
process.env.AUTH_SECRET = "accounts-test-secret-0123456789";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { auditLog } = await import("@/db/schema/audit");
const { session, user: userTable } = await import("@/db/schema/auth");
const { family, person } = await import("@/db/schema/family");
const { familyInvitation } = await import("@/db/schema/invitation");
const { performSetup } = await import("@/lib/auth/setup");
const { completeOnboarding, getUserBinding } = await import(
  "@/lib/family/service"
);
const {
  changeFamilyAccountRole,
  disableFamilyAccount,
  enableFamilyAccount,
  listFamilyAccounts,
} = await import("@/lib/accounts/service");
const {
  manuallyUnlockChildLater,
  setChildLaterUnlockAge,
  setPersonGuardian,
} = await import("@/lib/family/policy-service");
const { createFamilyInvitation, revokeFamilyInvitation } = await import(
  "@/lib/invitations/service"
);

const setup = await performSetup({
  token: "accounts-setup-token",
  displayName: "主管理员",
  email: "accounts-admin@example.com",
  password: "accounts-password-long-enough",
});
if (!setup.ok) throw new Error(`accounts setup failed: ${setup.error}`);

const primaryAdmin = (
  await getDb()
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, "accounts-admin@example.com"))
)[0];
const onboarding = await completeOnboarding(primaryAdmin.id, {
  familyName: "账号测试家庭",
  timezone: "Asia/Shanghai",
  childDisplayName: "孩子",
  childBirthDate: "2020-05-01",
  selfDisplayName: "主管理员",
  selfRelationToChild: "爸爸",
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${onboarding.error}`);
const familyId = onboarding.familyId;
const primaryBinding = await getUserBinding(primaryAdmin.id);

const secondaryAdminId = randomUUID();
const editorId = randomUUID();
const foreignFamilyId = randomUUID();
const foreignPersonId = randomUUID();
const foreignUserId = randomUUID();
const now = new Date();

await getDb().insert(family).values({
  id: foreignFamilyId,
  name: "其他家庭",
  timezone: "Asia/Shanghai",
  createdAt: now,
  updatedAt: now,
});
await getDb().insert(person).values({
  id: foreignPersonId,
  familyId: foreignFamilyId,
  displayName: "其他家庭成员",
  isChild: false,
  isGuardian: false,
  createdAt: now,
  updatedAt: now,
});
await getDb().insert(userTable).values([
  {
    id: secondaryAdminId,
    name: "备用管理员",
    email: "accounts-admin-2@example.com",
    emailVerified: false,
    role: "admin",
    familyId,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: editorId,
    name: "编辑者",
    email: "accounts-editor@example.com",
    emailVerified: false,
    role: "editor",
    familyId,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: foreignUserId,
    name: "外部账号",
    email: "accounts-foreign@example.com",
    emailVerified: false,
    role: "viewer",
    familyId: foreignFamilyId,
    personId: foreignPersonId,
    createdAt: now,
    updatedAt: now,
  },
]);

function primaryContext() {
  return {
    userId: primaryAdmin.id,
    userName: "主管理员",
    familyId,
    personId: primaryBinding.personId,
    role: "admin" as const,
    accountEnabled: true as const,
    isGuardian: false,
    familyTimezone: "Asia/Shanghai",
    childLaterUnlockAge: 18,
  };
}

function secondaryContext() {
  return {
    ...primaryContext(),
    userId: secondaryAdminId,
    userName: "备用管理员",
    personId: null,
  };
}

async function auditCount(): Promise<number> {
  return (await getDb().select({ id: auditLog.id }).from(auditLog)).length;
}

describe.sequential("family account administration", () => {
  it("lists only the live admin's family accounts", async () => {
    const accounts = await listFamilyAccounts(primaryContext());
    expect(accounts.map((account) => account.id)).toEqual(
      expect.arrayContaining([primaryAdmin.id, secondaryAdminId, editorId]),
    );
    expect(accounts.map((account) => account.id)).not.toContain(foreignUserId);
    expect(accounts.find((account) => account.id === primaryAdmin.id))
      .toMatchObject({ isCurrentUser: true, role: "admin" });
  });

  it("changes a role and writes the required audit in the same transaction", () => {
    const result = changeFamilyAccountRole(
      primaryContext(),
      editorId,
      "contributor",
    );
    expect(result).toEqual({ ok: true });
    const row = getDb()
      .select({ role: userTable.role })
      .from(userTable)
      .where(eq(userTable.id, editorId))
      .get();
    expect(row?.role).toBe("contributor");
    const entry = getDb()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.familyId, familyId),
          eq(auditLog.kind, "account.role_changed"),
        ),
      )
      .get();
    expect(entry?.actorUserId).toBe(primaryAdmin.id);
    expect(JSON.parse(entry?.detailJson ?? "{}")).toEqual({
      targetUserId: editorId,
      from: "editor",
      to: "contributor",
    });
  });

  it("does not reveal or mutate a cross-family target", async () => {
    const before = await auditCount();
    expect(
      changeFamilyAccountRole(primaryContext(), foreignUserId, "admin"),
    ).toEqual({ ok: false, error: "not_found" });
    expect(disableFamilyAccount(primaryContext(), foreignUserId)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await auditCount()).toBe(before);
    expect(
      getDb()
        .select({ role: userTable.role, disabledAt: userTable.disabledAt })
        .from(userTable)
        .where(eq(userTable.id, foreignUserId))
        .get(),
    ).toMatchObject({ role: "viewer", disabledAt: null });
  });

  it("revokes sessions on disable and starts recovery with no old sessions", () => {
    getDb()
      .insert(session)
      .values({
        id: randomUUID(),
        token: randomUUID(),
        userId: editorId,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    expect(disableFamilyAccount(primaryContext(), editorId)).toEqual({
      ok: true,
    });
    expect(
      getDb()
        .select({ id: session.id })
        .from(session)
        .where(eq(session.userId, editorId))
        .all(),
    ).toHaveLength(0);
    expect(() =>
      getDb()
        .insert(session)
        .values({
          id: randomUUID(),
          token: randomUUID(),
          userId: editorId,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run(),
    ).toThrow(/session requires enabled user/);
    expect(enableFamilyAccount(primaryContext(), editorId)).toEqual({ ok: true });
    expect(
      getDb()
        .select({ id: session.id })
        .from(session)
        .where(eq(session.userId, editorId))
        .all(),
    ).toHaveLength(0);
  });

  it("fails closed with zero writes when a captured actor context is stale", async () => {
    const before = await auditCount();
    getDb()
      .update(userTable)
      .set({ role: "viewer" })
      .where(eq(userTable.id, primaryAdmin.id))
      .run();

    expect(
      changeFamilyAccountRole(primaryContext(), editorId, "viewer"),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(setChildLaterUnlockAge(primaryContext(), 21)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await createFamilyInvitation({
        familyId,
        actorUserId: primaryAdmin.id,
        role: "viewer",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await auditCount()).toBe(before);

    getDb()
      .update(userTable)
      .set({ role: "admin" })
      .where(eq(userTable.id, primaryAdmin.id))
      .run();
  });

  it("a disabled administrator cannot administer invitations", async () => {
    const before = await auditCount();
    getDb()
      .update(userTable)
      .set({ disabledAt: new Date(), disabledByUserId: secondaryAdminId })
      .where(eq(userTable.id, primaryAdmin.id))
      .run();
    expect(
      await createFamilyInvitation({
        familyId,
        actorUserId: primaryAdmin.id,
        role: "viewer",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await auditCount()).toBe(before);
    getDb()
      .update(userTable)
      .set({ disabledAt: null, disabledByUserId: null })
      .where(eq(userTable.id, primaryAdmin.id))
      .run();
  });

  it("rechecks the actor inside invitation revocation", async () => {
    const invitation = await createFamilyInvitation({
      familyId,
      actorUserId: primaryAdmin.id,
      role: "viewer",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(invitation.ok).toBe(true);
    if (!invitation.ok) return;

    getDb()
      .update(userTable)
      .set({ role: "viewer" })
      .where(eq(userTable.id, primaryAdmin.id))
      .run();
    await expect(
      revokeFamilyInvitation({
        familyId,
        actorUserId: primaryAdmin.id,
        invitationId: invitation.invitationId,
      }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(
      getDb()
        .select({ revokedAt: familyInvitation.revokedAt })
        .from(familyInvitation)
        .where(eq(familyInvitation.id, invitation.invitationId))
        .get()?.revokedAt,
    ).toBeNull();
    getDb()
      .update(userTable)
      .set({ role: "admin" })
      .where(eq(userTable.id, primaryAdmin.id))
      .run();
  });

  it("allows safe self-demotion but the stale admin context immediately loses power", () => {
    expect(
      changeFamilyAccountRole(primaryContext(), primaryAdmin.id, "editor"),
    ).toEqual({ ok: true });
    expect(disableFamilyAccount(primaryContext(), editorId)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      changeFamilyAccountRole(
        secondaryContext(),
        primaryAdmin.id,
        "admin",
      ),
    ).toEqual({ ok: true });
  });

  it("cannot demote the last enabled admin, including at the database boundary", () => {
    expect(disableFamilyAccount(primaryContext(), secondaryAdminId)).toEqual({
      ok: true,
    });
    expect(
      changeFamilyAccountRole(primaryContext(), primaryAdmin.id, "viewer"),
    ).toEqual({ ok: false, error: "last_admin" });
    expect(() =>
      getDb()
        .update(userTable)
        .set({ role: "viewer" })
        .where(eq(userTable.id, primaryAdmin.id))
        .run(),
    ).toThrow(/family must retain an enabled admin/);
    expect(enableFamilyAccount(primaryContext(), secondaryAdminId)).toEqual({
      ok: true,
    });
  });

  it("refuses self-disable even when another administrator exists", () => {
    expect(disableFamilyAccount(primaryContext(), primaryAdmin.id)).toEqual({
      ok: false,
      error: "cannot_disable_self",
    });
  });

  it("enforces strict policy values and immutable Person family at SQL boundary", () => {
    const child = getDb()
      .select({ id: person.id })
      .from(person)
      .where(and(eq(person.familyId, familyId), eq(person.isChild, true)))
      .get();
    expect(child).toBeTruthy();
    expect(() =>
      getDb().run(
        sql`UPDATE family SET child_later_unlock_age = 18.5 WHERE id = ${familyId}`,
      ),
    ).toThrow();
    expect(() =>
      getDb().run(
        sql`UPDATE person SET child_later_unlocked_at = -1 WHERE id = ${child!.id}`,
      ),
    ).toThrow();
    expect(() =>
      getDb().run(
        sql`UPDATE person SET family_id = ${foreignFamilyId} WHERE id = ${child!.id}`,
      ),
    ).toThrow();
  });

  it("database-level disable revokes sessions and fences stale session writes", () => {
    getDb()
      .insert(session)
      .values({
        id: randomUUID(),
        token: randomUUID(),
        userId: editorId,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    getDb()
      .update(userTable)
      .set({ disabledAt: new Date(), disabledByUserId: primaryAdmin.id })
      .where(eq(userTable.id, editorId))
      .run();
    expect(
      getDb()
        .select({ id: session.id })
        .from(session)
        .where(eq(session.userId, editorId))
        .all(),
    ).toHaveLength(0);
    expect(() =>
      getDb()
        .insert(session)
        .values({
          id: randomUUID(),
          token: randomUUID(),
          userId: editorId,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run(),
    ).toThrow();
    getDb()
      .update(userTable)
      .set({ disabledAt: null, disabledByUserId: null })
      .where(eq(userTable.id, editorId))
      .run();
  });

  it("changes explicit guardian and unlock-age policy with required audit", () => {
    const actorPersonId = primaryBinding.personId!;
    expect(setPersonGuardian(primaryContext(), actorPersonId, true)).toEqual({
      ok: true,
    });
    expect(
      getDb()
        .select({ guardian: person.isGuardian })
        .from(person)
        .where(eq(person.id, actorPersonId))
        .get()?.guardian,
    ).toBe(true);
    expect(setChildLaterUnlockAge(primaryContext(), 21)).toEqual({ ok: true });
    expect(
      getDb()
        .select({ age: family.childLaterUnlockAge })
        .from(family)
        .where(eq(family.id, familyId))
        .get()?.age,
    ).toBe(21);
    expect(setPersonGuardian(primaryContext(), actorPersonId, false)).toEqual({
      ok: true,
    });
    expect(setChildLaterUnlockAge(primaryContext(), 18)).toEqual({ ok: true });
  });

  it("rolls back security mutations and session deletion when required audit fails", () => {
    const child = getDb()
      .select({ id: person.id, unlockedAt: person.childLaterUnlockedAt })
      .from(person)
      .where(and(eq(person.familyId, familyId), eq(person.isChild, true)))
      .get()!;
    const actorPersonId = primaryBinding.personId!;
    getDb().run(sql`
      CREATE TRIGGER fail_required_audit
      BEFORE INSERT ON audit_log
      BEGIN
        SELECT RAISE(ABORT, 'required audit unavailable');
      END
    `);
    try {
      expect(() =>
        changeFamilyAccountRole(primaryContext(), editorId, "viewer"),
      ).toThrow(/required audit unavailable/);
      expect(
        getDb()
          .select({ role: userTable.role })
          .from(userTable)
          .where(eq(userTable.id, editorId))
          .get()?.role,
      ).toBe("contributor");

      getDb()
        .insert(session)
        .values({
          id: randomUUID(),
          token: randomUUID(),
          userId: editorId,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
      expect(() => disableFamilyAccount(primaryContext(), editorId)).toThrow(
        /required audit unavailable/,
      );
      expect(
        getDb()
          .select({ disabledAt: userTable.disabledAt })
          .from(userTable)
          .where(eq(userTable.id, editorId))
          .get()?.disabledAt,
      ).toBeNull();
      expect(
        getDb()
          .select({ id: session.id })
          .from(session)
          .where(eq(session.userId, editorId))
          .all(),
      ).toHaveLength(1);

      getDb()
        .update(userTable)
        .set({ disabledAt: new Date(), disabledByUserId: primaryAdmin.id })
        .where(eq(userTable.id, editorId))
        .run();
      expect(() => enableFamilyAccount(primaryContext(), editorId)).toThrow(
        /required audit unavailable/,
      );
      expect(
        getDb()
          .select({ disabledAt: userTable.disabledAt })
          .from(userTable)
          .where(eq(userTable.id, editorId))
          .get()?.disabledAt,
      ).not.toBeNull();
      getDb()
        .update(userTable)
        .set({ disabledAt: null, disabledByUserId: null })
        .where(eq(userTable.id, editorId))
        .run();

      expect(() =>
        setChildLaterUnlockAge(primaryContext(), 21),
      ).toThrow(/required audit unavailable/);
      expect(
        getDb()
          .select({ age: family.childLaterUnlockAge })
          .from(family)
          .where(eq(family.id, familyId))
          .get()?.age,
      ).toBe(18);

      expect(() =>
        setPersonGuardian(primaryContext(), actorPersonId, true),
      ).toThrow(/required audit unavailable/);
      expect(
        getDb()
          .select({ guardian: person.isGuardian })
          .from(person)
          .where(eq(person.id, actorPersonId))
          .get()?.guardian,
      ).toBe(false);
      expect(() =>
        manuallyUnlockChildLater(primaryContext(), child.id),
      ).toThrow(/required audit unavailable/);
      expect(
        getDb()
          .select({ unlockedAt: person.childLaterUnlockedAt })
          .from(person)
          .where(eq(person.id, child.id))
          .get()?.unlockedAt,
      ).toEqual(child.unlockedAt);
    } finally {
      getDb().run(sql`DROP TRIGGER IF EXISTS fail_required_audit`);
      getDb().delete(session).where(eq(session.userId, editorId)).run();
    }
  });

  it("manual child unlock is irreversible", () => {
    const child = getDb()
      .select({ id: person.id })
      .from(person)
      .where(and(eq(person.familyId, familyId), eq(person.isChild, true)))
      .get()!;
    expect(manuallyUnlockChildLater(primaryContext(), child.id)).toEqual({
      ok: true,
    });
    expect(
      getDb()
        .select({ unlockedAt: person.childLaterUnlockedAt })
        .from(person)
        .where(eq(person.id, child.id))
        .get()?.unlockedAt,
    ).toBeInstanceOf(Date);
    expect(manuallyUnlockChildLater(primaryContext(), child.id)).toEqual({
      ok: false,
      error: "already_unlocked",
    });
    expect(() =>
      getDb()
        .update(person)
        .set({ childLaterUnlockedAt: null })
        .where(eq(person.id, child.id))
        .run(),
    ).toThrow();
  });
});
