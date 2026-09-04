import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { user as userTable } from "@/db/schema/auth";
import { family, person } from "@/db/schema/family";
import {
  assertFamilyCapability,
  isFamilyRole,
  type FamilyRole,
} from "@/lib/authz/policy";
import type { FamilyContext } from "@/lib/family/context";

/**
 * 家庭域服务（Issue #003）。
 * 所有查询必须带 familyId 条件——family 是数据隔离边界（#017 审计基础）。
 */

export type OnboardingInput = {
  familyName: string;
  timezone: string;
  childDisplayName: string;
  childBirthDate: string; // YYYY-MM-DD，孩子的成长时间轴基准
  selfDisplayName: string;
  selfRelationToChild: string;
  selfIsGuardian?: boolean;
};

export type OnboardingResult =
  | { ok: true; familyId: string }
  | { ok: false; error: "already_bound" | "invalid_input" };

export type AddPersonInput = {
  displayName: string;
  relationToChild?: string;
  birthDate?: string;
  isChild?: boolean;
};

const TIMEZONES = new Set(
  typeof Intl.supportedValuesOf === "function"
    ? (Intl.supportedValuesOf("timeZone") as string[])
    : [],
);

export function isValidTimezone(tz: string): boolean {
  return TIMEZONES.has(tz);
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type UserBinding = {
  familyId: string | null;
  personId: string | null;
  role: FamilyRole;
  accountEnabled: true;
  isGuardian: boolean;
  familyTimezone: string | null;
  childLaterUnlockAge: number | null;
};

export class InvalidUserBindingError extends Error {
  readonly code:
    | "user_not_found"
    | "invalid_family_role"
    | "account_disabled"
    | "invalid_family_binding"
    | "invalid_person_binding";

  constructor(code: InvalidUserBindingError["code"]) {
    const messages: Record<InvalidUserBindingError["code"], string> = {
      user_not_found: "authenticated user no longer exists",
      invalid_family_role: "authenticated user has an invalid family role",
      account_disabled: "authenticated user account is disabled",
      invalid_family_binding: "authenticated user has an invalid family binding",
      invalid_person_binding: "authenticated user has an invalid Person binding",
    };
    super(messages[code]);
    this.name = "InvalidUserBindingError";
    this.code = code;
  }
}

/**
 * The database role is untrusted text until it passes the durable four-role
 * policy. Never coerce an unknown value to admin or another permissive role.
 */
export async function getUserBinding(userId: string): Promise<UserBinding> {
  const db = getDb();
  const rows = await db
    .select({
      familyId: userTable.familyId,
      personId: userTable.personId,
      role: userTable.role,
      disabledAt: userTable.disabledAt,
      boundPersonId: person.id,
      boundPersonFamilyId: person.familyId,
      isGuardian: person.isGuardian,
      boundFamilyId: family.id,
      familyTimezone: family.timezone,
      childLaterUnlockAge: family.childLaterUnlockAge,
    })
    .from(userTable)
    .leftJoin(person, eq(userTable.personId, person.id))
    .leftJoin(family, eq(userTable.familyId, family.id))
    .where(eq(userTable.id, userId));
  const row = rows[0];
  if (!row) throw new InvalidUserBindingError("user_not_found");
  if (row.disabledAt !== null) {
    throw new InvalidUserBindingError("account_disabled");
  }
  const role = row.role;
  if (!isFamilyRole(role)) {
    throw new InvalidUserBindingError("invalid_family_role");
  }
  if (row.familyId !== null && row.boundFamilyId !== row.familyId) {
    throw new InvalidUserBindingError("invalid_family_binding");
  }
  if (
    row.personId !== null &&
    (row.boundPersonId !== row.personId ||
      row.boundPersonFamilyId !== row.familyId)
  ) {
    throw new InvalidUserBindingError("invalid_person_binding");
  }
  return {
    familyId: row.familyId,
    personId: row.personId,
    role,
    accountEnabled: true,
    isGuardian: row.isGuardian ?? false,
    familyTimezone: row.familyTimezone ?? null,
    childLaterUnlockAge: row.childLaterUnlockAge ?? null,
  };
}

export async function getFamily(familyId: string) {
  const db = getDb();
  const rows = await db.select().from(family).where(eq(family.id, familyId));
  return rows[0];
}

export async function listPeople(familyId: string) {
  const db = getDb();
  return db
    .select()
    .from(person)
    .where(eq(person.familyId, familyId))
    .orderBy(asc(person.createdAt));
}

export function validateOnboardingInput(input: OnboardingInput): boolean {
  const familyName = input.familyName.trim();
  if (familyName.length < 1 || familyName.length > 50) return false;
  if (!isValidTimezone(input.timezone)) return false;
  const childName = input.childDisplayName.trim();
  if (childName.length < 1 || childName.length > 50) return false;
  if (!isValidDateString(input.childBirthDate)) return false;
  const selfName = input.selfDisplayName.trim();
  if (selfName.length < 1 || selfName.length > 50) return false;
  const relation = input.selfRelationToChild.trim();
  if (relation.length < 1 || relation.length > 20) return false;
  return true;
}

/**
 * 首次 onboarding：一个事务里创建 Family + 女儿 Person + 管理员 Person，
 * 并把登录 User 绑定到家庭与自己的 Person（PRD §10 User ↔ Person 可选关联）。
 */
export async function completeOnboarding(
  adminUserId: string,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  const db = getDb();
  const binding = await getUserBinding(adminUserId);
  if (binding.familyId) return { ok: false, error: "already_bound" };
  if (!validateOnboardingInput(input)) return { ok: false, error: "invalid_input" };

  const familyId = randomUUID();
  const childPersonId = randomUUID();
  const selfPersonId = randomUUID();
  const now = new Date();

  // better-sqlite3 的事务是同步回调（不能返回 Promise）
  db.transaction((tx) => {
    tx.insert(family)
      .values({
        id: familyId,
        name: input.familyName.trim(),
        timezone: input.timezone,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(person)
      .values([
        {
          id: childPersonId,
          familyId,
          displayName: input.childDisplayName.trim(),
          isChild: true,
          birthDate: input.childBirthDate,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: selfPersonId,
          familyId,
          displayName: input.selfDisplayName.trim(),
          relationToChild: input.selfRelationToChild.trim(),
          isChild: false,
          isGuardian: input.selfIsGuardian === true,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
    tx.update(userTable)
      .set({ familyId, personId: selfPersonId, updatedAt: now })
      .where(eq(userTable.id, adminUserId))
      .run();
  });

  return { ok: true, familyId };
}

export type AddPersonResult =
  | { ok: true; personId: string }
  | { ok: false; error: "invalid_input" };

export function validateAddPersonInput(input: AddPersonInput): boolean {
  const name = input.displayName.trim();
  if (name.length < 1 || name.length > 50) return false;
  if (
    input.relationToChild !== undefined &&
    input.relationToChild.trim().length > 20
  ) {
    return false;
  }
  if (input.birthDate !== undefined && input.birthDate !== "") {
    if (!isValidDateString(input.birthDate)) return false;
  }
  return true;
}

/** 添加没有登录账号的家庭成员（祖辈等）——Person 不要求 User。 */
export async function addPerson(
  familyId: string,
  input: AddPersonInput,
): Promise<AddPersonResult> {
  if (!validateAddPersonInput(input)) return { ok: false, error: "invalid_input" };
  const db = getDb();
  const personId = randomUUID();
  const now = new Date();
  await db.insert(person).values({
    id: personId,
    familyId,
    displayName: input.displayName.trim(),
    relationToChild: input.relationToChild?.trim() || null,
    isChild: input.isChild ?? false,
    birthDate: input.birthDate || null,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, personId };
}

export async function updatePerson(
  context: FamilyContext,
  personId: string,
  input: AddPersonInput,
): Promise<{ ok: true } | { ok: false; error: "forbidden" | "invalid" | "not_found" }> {
  try {
    assertFamilyCapability(context.role, "family:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!validateAddPersonInput(input)) return { ok: false, error: "invalid" };
  const existing = await getDb().select({ id: person.id }).from(person).where(and(
    eq(person.id, personId),
    eq(person.familyId, context.familyId),
  )).limit(1);
  if (!existing[0]) return { ok: false, error: "not_found" };
  await getDb().update(person).set({
    displayName: input.displayName.trim(),
    relationToChild: input.relationToChild?.trim() || null,
    birthDate: input.birthDate?.trim() || null,
    updatedAt: new Date(),
  }).where(and(eq(person.id, personId), eq(person.familyId, context.familyId)));
  return { ok: true };
}

/**
 * 把登录 User 绑定到 Person（必须属于同一 family，防跨家庭绑定）。
 * 用于以后给祖辈开账号时关联既有 Person。
 */
export async function bindUserToPerson(
  userId: string,
  familyId: string,
  personId: string,
): Promise<boolean> {
  const db = getDb();
  const target = await db
    .select({ id: person.id, familyId: person.familyId })
    .from(person)
    .where(eq(person.id, personId));
  if (!target[0] || target[0].familyId !== familyId) return false;
  await db
    .update(userTable)
    .set({ personId, updatedAt: new Date() })
    .where(eq(userTable.id, userId));
  return true;
}

/**
 * RH-004 / 恢复后的绑定流程：实例里已有（被恢复的）家庭时，
 * 管理员不再「创建家庭」，而是把自己绑定到家庭中的某个 Person。
 * 仅当实例恰好一个家庭且用户未绑定时可用。
 */
export async function getRestorableFamilyForUser(userId: string): Promise<{
  family: typeof family.$inferSelect;
  people: PersonRowLite[];
} | null> {
  const db = getDb();
  const binding = await getUserBinding(userId);
  if (binding.familyId) return null;
  const families = await db.select().from(family).limit(2);
  if (families.length !== 1) return null;
  const people = await db
    .select()
    .from(person)
    .where(eq(person.familyId, families[0].id));
  return { family: families[0], people };
}

type PersonRowLite = typeof person.$inferSelect;

export type BindResult =
  | { ok: true; familyId: string }
  | { ok: false; error: "no_restored_family" | "bad_person" | "already_bound" };

/** 绑定到被恢复家庭中的某个 Person（普通成员优先，孩子不允许作为登录身份） */
export async function bindRestoredFamily(
  userId: string,
  personId: string,
): Promise<BindResult> {
  const db = getDb();
  const restorable = await getRestorableFamilyForUser(userId);
  if (!restorable) {
    const binding = await getUserBinding(userId);
    if (binding.familyId) return { ok: false, error: "already_bound" };
    return { ok: false, error: "no_restored_family" };
  }
  const target = restorable.people.find((p) => p.id === personId);
  if (!target || target.isChild) return { ok: false, error: "bad_person" };
  await db
    .update(userTable)
    .set({
      familyId: restorable.family.id,
      personId: target.id,
      updatedAt: new Date(),
    })
    .where(eq(userTable.id, userId));
  return { ok: true, familyId: restorable.family.id };
}
