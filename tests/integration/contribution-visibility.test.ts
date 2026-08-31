import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-contribution-visibility-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "visibility-setup-token";
process.env.AUTH_SECRET = "visibility-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const setup = await performSetup({
  token: "visibility-setup-token",
  displayName: "爸爸管理员",
  email: "visibility-admin@example.com",
  password: "a-long-enough-password",
});
if (!setup.ok) throw new Error("setup failed");

const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { person: personTable } = await import("@/db/schema/family");
const { memoryEvent } = await import("@/db/schema/memory");
const { contribution } = await import("@/db/schema/contribution");
const { capsuleContribution } = await import("@/db/schema/capsule");
const { completeOnboarding, getUserBinding, listPeople } = await import(
  "@/lib/family/service"
);
const {
  createContributionAccessSnapshot,
  listVisibleContributionsForEvent,
  updateVisibleContributionText,
} = await import("@/lib/authz/contribution-access");
const {
  addCapsuleContribution,
  createCapsule,
  getCapsuleDetail,
  getCompleteCapsuleDetailForDisasterExport,
  listCapsules,
  sealCapsule,
} = await import("@/lib/capsules/service");

const db = getDb();
const adminUserId = (
  await db.select({ id: userTable.id }).from(userTable)
)[0].id;
const onboarding = await completeOnboarding(adminUserId, {
  familyName: "可见性测试家庭",
  timezone: "America/Los_Angeles",
  childDisplayName: "闰日孩子",
  childBirthDate: "2024-02-29",
  selfDisplayName: "爸爸管理员",
  selfRelationToChild: "爸爸",
  selfIsGuardian: false,
});
if (!onboarding.ok) throw new Error("onboarding failed");
const familyId = onboarding.familyId;
const onboardingPeople = await listPeople(familyId);
const leapChild = onboardingPeople.find((row) => row.isChild);
if (!leapChild) throw new Error("child unavailable");

const ids = {
  authorPerson: randomUUID(),
  guardianPerson: randomUUID(),
  labelOnlyPerson: randomUUID(),
  stalePerson: randomUUID(),
  missingBirthChild: randomUUID(),
  manualUnlockChild: randomUUID(),
  authorUser: randomUUID(),
  guardianUser: randomUUID(),
  labelOnlyUser: randomUUID(),
  staleUser: randomUUID(),
  leapEvent: randomUUID(),
  missingBirthEvent: randomUUID(),
  manualUnlockEvent: randomUUID(),
  staleEvent: randomUUID(),
  privateContribution: randomUUID(),
  parentsContribution: randomUUID(),
  familyContribution: randomUUID(),
  childLaterContribution: randomUUID(),
  missingBirthContribution: randomUUID(),
  manualUnlockContribution: randomUUID(),
  staleVisibilityContribution: randomUUID(),
};
const seededAt = new Date("2030-01-01T00:00:00.000Z");
const manualUnlockAt = new Date("2041-06-01T00:00:00.000Z");

db.insert(personTable)
  .values([
    {
      id: ids.authorPerson,
      familyId,
      displayName: "作者",
      relationToChild: "姑姑",
      isChild: false,
      isGuardian: false,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: ids.guardianPerson,
      familyId,
      displayName: "显式监护人",
      relationToChild: "家人",
      isChild: false,
      isGuardian: true,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: ids.labelOnlyPerson,
      familyId,
      displayName: "只有称谓的妈妈",
      relationToChild: "妈妈",
      isChild: false,
      isGuardian: false,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: ids.stalePerson,
      familyId,
      displayName: "权限会变化的家人",
      relationToChild: "叔叔",
      isChild: false,
      isGuardian: false,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: ids.missingBirthChild,
      familyId,
      displayName: "生日未知的孩子",
      isChild: true,
      isGuardian: false,
      birthDate: null,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: ids.manualUnlockChild,
      familyId,
      displayName: "手工解锁的孩子",
      isChild: true,
      isGuardian: false,
      birthDate: null,
      childLaterUnlockedAt: manualUnlockAt,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  ])
  .run();

function userValues(
  id: string,
  name: string,
  role: "admin" | "editor" | "contributor" | "viewer",
  personId: string,
) {
  return {
    id,
    name,
    email: `${id}@visibility.example.com`,
    emailVerified: false,
    role,
    familyId,
    personId,
    createdAt: seededAt,
    updatedAt: seededAt,
  };
}

db.insert(userTable)
  .values([
    userValues(ids.authorUser, "作者", "contributor", ids.authorPerson),
    userValues(ids.guardianUser, "显式监护人", "editor", ids.guardianPerson),
    userValues(ids.labelOnlyUser, "只有称谓的妈妈", "viewer", ids.labelOnlyPerson),
    userValues(ids.staleUser, "权限会变化的家人", "viewer", ids.stalePerson),
  ])
  .run();

db.insert(memoryEvent)
  .values([
    {
      id: ids.leapEvent,
      familyId,
      childPersonId: leapChild.id,
      title: "闰日孩子的记忆",
      occurredAt: seededAt,
      status: "confirmed",
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: ids.missingBirthEvent,
      familyId,
      childPersonId: ids.missingBirthChild,
      title: "生日未知",
      occurredAt: seededAt,
      status: "confirmed",
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: ids.manualUnlockEvent,
      familyId,
      childPersonId: ids.manualUnlockChild,
      title: "手工解锁",
      occurredAt: seededAt,
      status: "confirmed",
      createdAt: seededAt,
      updatedAt: seededAt,
    },
    {
      id: ids.staleEvent,
      familyId,
      childPersonId: leapChild.id,
      title: "写入前策略变化",
      occurredAt: seededAt,
      status: "confirmed",
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  ])
  .run();

function contributionValues(
  id: string,
  memoryEventId: string,
  visibility: "private" | "parents" | "family" | "child_later",
) {
  return {
    id,
    memoryEventId,
    authorPersonId: ids.authorPerson,
    rawText: `${visibility}:${id}`,
    visibility,
    recordingMode: "legacy",
    createdAt: seededAt,
    updatedAt: seededAt,
  };
}

db.insert(contribution)
  .values([
    contributionValues(ids.privateContribution, ids.leapEvent, "private"),
    contributionValues(ids.parentsContribution, ids.leapEvent, "parents"),
    contributionValues(ids.familyContribution, ids.leapEvent, "family"),
    contributionValues(
      ids.childLaterContribution,
      ids.leapEvent,
      "child_later",
    ),
    contributionValues(
      ids.missingBirthContribution,
      ids.missingBirthEvent,
      "child_later",
    ),
    contributionValues(
      ids.manualUnlockContribution,
      ids.manualUnlockEvent,
      "child_later",
    ),
    contributionValues(
      ids.staleVisibilityContribution,
      ids.staleEvent,
      "family",
    ),
  ])
  .run();

async function accessFor(userId: string, evaluatedAt: Date) {
  const binding = await getUserBinding(userId);
  if (
    !binding.familyId ||
    !binding.familyTimezone ||
    binding.childLaterUnlockAge === null
  ) {
    throw new Error("binding unavailable");
  }
  return createContributionAccessSnapshot(
    {
      userId,
      userName: "测试账号",
      familyId: binding.familyId,
      personId: binding.personId,
      role: binding.role,
      accountEnabled: binding.accountEnabled,
      isGuardian: binding.isGuardian,
      familyTimezone: binding.familyTimezone,
      childLaterUnlockAge: binding.childLaterUnlockAge,
    },
    evaluatedAt,
  );
}

function idsOf(rows: readonly { id: string }[]) {
  return rows.map((row) => row.id).sort();
}

const beforeLeapBirthday = new Date("2042-02-28T07:59:59.000Z");
const atLeapBirthday = new Date("2042-02-28T08:00:00.000Z");

describe("Contribution live visibility DAL", () => {
  it("enforces private/parents/family/child_later without an admin bypass", async () => {
    const [authorAccess, guardianAccess, adminAccess, labelOnlyAccess] =
      await Promise.all([
        accessFor(ids.authorUser, beforeLeapBirthday),
        accessFor(ids.guardianUser, beforeLeapBirthday),
        accessFor(adminUserId, beforeLeapBirthday),
        accessFor(ids.labelOnlyUser, beforeLeapBirthday),
      ]);

    expect(
      idsOf(await listVisibleContributionsForEvent(authorAccess, ids.leapEvent)),
    ).toEqual(
      [
        ids.privateContribution,
        ids.parentsContribution,
        ids.familyContribution,
        ids.childLaterContribution,
      ].sort(),
    );
    expect(
      idsOf(
        await listVisibleContributionsForEvent(guardianAccess, ids.leapEvent),
      ),
    ).toEqual(
      [
        ids.parentsContribution,
        ids.familyContribution,
        ids.childLaterContribution,
      ].sort(),
    );
    expect(
      idsOf(await listVisibleContributionsForEvent(adminAccess, ids.leapEvent)),
    ).toEqual([ids.familyContribution]);
    expect(
      idsOf(
        await listVisibleContributionsForEvent(labelOnlyAccess, ids.leapEvent),
      ),
    ).toEqual([ids.familyContribution]);
  });

  it("uses the family timezone and Feb-29 floor, while missing birth stays locked", async () => {
    const before = await accessFor(ids.labelOnlyUser, beforeLeapBirthday);
    const at = await accessFor(ids.labelOnlyUser, atLeapBirthday);
    expect(
      idsOf(await listVisibleContributionsForEvent(before, ids.leapEvent)),
    ).toEqual([ids.familyContribution]);
    expect(
      idsOf(await listVisibleContributionsForEvent(at, ids.leapEvent)),
    ).toEqual([ids.childLaterContribution, ids.familyContribution].sort());
    expect(
      await listVisibleContributionsForEvent(at, ids.missingBirthEvent),
    ).toHaveLength(0);
  });

  it("honors an explicit irreversible unlock only from its recorded instant", async () => {
    const before = await accessFor(
      ids.labelOnlyUser,
      new Date(manualUnlockAt.getTime() - 1),
    );
    const at = await accessFor(ids.labelOnlyUser, manualUnlockAt);
    expect(
      await listVisibleContributionsForEvent(before, ids.manualUnlockEvent),
    ).toHaveLength(0);
    expect(
      idsOf(await listVisibleContributionsForEvent(at, ids.manualUnlockEvent)),
    ).toEqual([ids.manualUnlockContribution]);
  });

  it("rejects stale roles, disabled accounts, and non-author edits", async () => {
    const staleRole = await accessFor(ids.staleUser, atLeapBirthday);
    db.update(userTable)
      .set({ role: "contributor", updatedAt: atLeapBirthday })
      .where(eq(userTable.id, ids.staleUser))
      .run();
    expect(
      await listVisibleContributionsForEvent(staleRole, ids.leapEvent),
    ).toHaveLength(0);

    const adminAccess = await accessFor(adminUserId, atLeapBirthday);
    expect(
      updateVisibleContributionText(
        adminAccess,
        ids.privateContribution,
        "管理员不能改作者私密讲述",
      ),
    ).toEqual({ ok: false, error: "forbidden_or_not_found" });

    const authorAccess = await accessFor(ids.authorUser, atLeapBirthday);
    expect(
      updateVisibleContributionText(
        authorAccess,
        ids.privateContribution,
        "作者自己的修改",
      ),
    ).toEqual({ ok: true, memoryEventId: ids.leapEvent });
    db.update(userTable)
      .set({
        disabledAt: atLeapBirthday,
        disabledByUserId: adminUserId,
        updatedAt: atLeapBirthday,
      })
      .where(eq(userTable.id, ids.authorUser))
      .run();
    expect(
      await listVisibleContributionsForEvent(authorAccess, ids.leapEvent),
    ).toHaveLength(0);
    expect(
      updateVisibleContributionText(
        authorAccess,
        ids.familyContribution,
        "停用后不能写",
      ),
    ).toEqual({ ok: false, error: "forbidden_or_not_found" });
  });
});

describe("Capsule visibility intersection", () => {
  it("filters detail/count/add and keeps the explicit disaster reader complete", async () => {
    const adminAccess = await accessFor(adminUserId, beforeLeapBirthday);
    const created = await createCapsule(familyId, {
      title: "可见性胶囊",
      unlockType: "date",
      unlockValue: "2042-02-28",
    });
    if (!created.ok) throw new Error("capsule create failed");

    expect(
      await addCapsuleContribution(
        adminAccess,
        created.capsuleId,
        ids.familyContribution,
      ),
    ).toBe(true);
    expect(
      await addCapsuleContribution(
        adminAccess,
        created.capsuleId,
        ids.privateContribution,
      ),
    ).toBe(false);

    // Historical/restored links can contain rows the current viewer cannot
    // see; ordinary detail and counts still filter them at read time.
    db.insert(capsuleContribution)
      .values({
        id: randomUUID(),
        capsuleId: created.capsuleId,
        contributionId: ids.privateContribution,
        familyId,
        createdAt: seededAt,
      })
      .run();

    const draft = await getCapsuleDetail(
      adminAccess,
      created.capsuleId,
      leapChild.birthDate,
    );
    expect(idsOf(draft?.contributions ?? [])).toEqual([ids.familyContribution]);
    const list = await listCapsules(adminAccess, leapChild.birthDate);
    expect(list.find((row) => row.id === created.capsuleId)?.itemCount).toBe(1);

    await sealCapsule(familyId, created.capsuleId);
    const locked = await getCapsuleDetail(
      adminAccess,
      created.capsuleId,
      leapChild.birthDate,
    );
    expect(locked?.unlocked).toBe(false);
    expect(locked?.contributions).toHaveLength(0);

    const unlockedAdmin = await accessFor(adminUserId, atLeapBirthday);
    const openedByTime = await getCapsuleDetail(
      unlockedAdmin,
      created.capsuleId,
      leapChild.birthDate,
    );
    expect(openedByTime?.unlocked).toBe(true);
    expect(idsOf(openedByTime?.contributions ?? [])).toEqual([
      ids.familyContribution,
    ]);

    const complete = await getCompleteCapsuleDetailForDisasterExport(
      familyId,
      created.capsuleId,
      leapChild.birthDate,
      "America/Los_Angeles",
      beforeLeapBirthday,
    );
    expect(idsOf(complete?.contributions ?? [])).toEqual(
      [ids.familyContribution, ids.privateContribution].sort(),
    );
  });

  it("rechecks guardian and row visibility inside the same write transaction", async () => {
    const guardianAccess = await accessFor(
      ids.guardianUser,
      beforeLeapBirthday,
    );
    const guardianCapsule = await createCapsule(familyId, {
      title: "监护人撤销测试",
      unlockType: "date",
      unlockValue: "2099-01-01",
    });
    if (!guardianCapsule.ok) throw new Error("capsule create failed");

    db.update(personTable)
      .set({ isGuardian: false, updatedAt: seededAt })
      .where(eq(personTable.id, ids.guardianPerson))
      .run();
    expect(
      await addCapsuleContribution(
        guardianAccess,
        guardianCapsule.capsuleId,
        ids.parentsContribution,
      ),
    ).toBe(false);

    const adminAccess = await accessFor(adminUserId, beforeLeapBirthday);
    const visibilityCapsule = await createCapsule(familyId, {
      title: "可见范围变化测试",
      unlockType: "date",
      unlockValue: "2099-01-01",
    });
    if (!visibilityCapsule.ok) throw new Error("capsule create failed");
    db.update(contribution)
      .set({ visibility: "private", updatedAt: seededAt })
      .where(eq(contribution.id, ids.staleVisibilityContribution))
      .run();
    expect(
      await addCapsuleContribution(
        adminAccess,
        visibilityCapsule.capsuleId,
        ids.staleVisibilityContribution,
      ),
    ).toBe(false);
  });
});
