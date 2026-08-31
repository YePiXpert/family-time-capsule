import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

// 环境必须在动态导入前设置（lib/paths 在模块加载时读取 DATA_DIR）
const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-family-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "family-setup-token";
process.env.AUTH_SECRET = "family-test-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup } = await import("@/lib/auth/setup");
const { getDb } = await import("@/db");
const { user: userTable } = await import("@/db/schema/auth");
const { person } = await import("@/db/schema/family");
const {
  completeOnboarding,
  addPerson,
  listPeople,
  getUserBinding,
  bindUserToPerson,
  isValidDateString,
} = await import("@/lib/family/service");

const ADMIN = {
  token: "family-setup-token",
  displayName: "爸爸",
  email: "dad@example.com",
  password: "a-long-enough-password",
};

// 先创建唯一的管理员（模块级串行，后续测试依赖它）
const setupResult = await performSetup(ADMIN);
if (!setupResult.ok) throw new Error(`setup failed: ${setupResult.error}`);

async function getAdminUserId(): Promise<string> {
  const db = getDb();
  const rows = await db.select({ id: userTable.id }).from(userTable);
  return rows[0].id;
}

describe("onboarding：创建家庭与人物", () => {
  it("非法输入被拒绝", async () => {
    const userId = await getAdminUserId();
    const bad = await completeOnboarding(userId, {
      familyName: "",
      timezone: "Not/AZone",
      childDisplayName: "小满",
      childBirthDate: "2026-08-10",
      selfDisplayName: "爸爸",
      selfRelationToChild: "爸爸",
    });
    expect(bad).toEqual({ ok: false, error: "invalid_input" });
  });

  it("创建家庭 + 女儿 Person + 自己 Person，并绑定 User", async () => {
    const userId = await getAdminUserId();
    const result = await completeOnboarding(userId, {
      familyName: "我们一家",
      timezone: "Asia/Shanghai",
      childDisplayName: "小满",
      childBirthDate: "2026-08-10",
      selfDisplayName: "爸爸",
      selfRelationToChild: "爸爸",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const binding = await getUserBinding(userId);
    expect(binding.familyId).toBe(result.familyId);
    expect(binding.personId).toBeTruthy();
    expect(binding.role).toBe("admin");

    const people = await listPeople(result.familyId);
    expect(people).toHaveLength(2);
    const child = people.find((p) => p.isChild);
    expect(child?.displayName).toBe("小满");
    expect(child?.birthDate).toBe("2026-08-10");
    expect(child?.relationToChild).toBeNull();
    const dad = people.find((p) => !p.isChild);
    expect(dad?.displayName).toBe("爸爸");
    expect(dad?.relationToChild).toBe("爸爸");
    // 称谓只是展示文本；未显式选择时绝不推断监护人权限。
    expect(dad?.isGuardian).toBe(false);
    expect(binding.isGuardian).toBe(false);
    // 管理员 Person 即 User 绑定的 Person
    expect(dad?.id).toBe(binding.personId);
  });

  it("数据库拒绝未知持久化角色，并保留原管理员", async () => {
    const userId = await getAdminUserId();
    const db = getDb();
    let failure: unknown;
    try {
      db.run(sql`UPDATE user SET role = 'owner' WHERE id = ${userId}`);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const cause = (failure as Error & { cause?: { code?: string; message?: string } })
      .cause;
    expect(cause?.code).toBe("SQLITE_CONSTRAINT_TRIGGER");
    await expect(getUserBinding(userId)).resolves.toMatchObject({ role: "admin" });
  });

  it("已绑定后重复 onboarding 被拒绝", async () => {
    const userId = await getAdminUserId();
    const result = await completeOnboarding(userId, {
      familyName: "又一个家",
      timezone: "Asia/Shanghai",
      childDisplayName: "小满",
      childBirthDate: "2026-08-10",
      selfDisplayName: "爸爸",
      selfRelationToChild: "爸爸",
    });
    expect(result).toEqual({ ok: false, error: "already_bound" });
  });
});

describe("Person 与 User 分离", () => {
  it("添加没有账号的祖辈 Person", async () => {
    const binding = await getUserBinding(await getAdminUserId());
    const familyId = binding.familyId!;
    const result = await addPerson(familyId, {
      displayName: "外婆",
      relationToChild: "外婆",
    });
    expect(result.ok).toBe(true);
    const people = await listPeople(familyId);
    expect(people).toHaveLength(3);
    const grandma = people.find((p) => p.displayName === "外婆");
    expect(grandma).toBeTruthy();
    // 没有 User 绑定也能存在
    expect(grandma?.isChild).toBe(false);
    expect(grandma?.birthDate).toBeNull();
  });

  it("非法 Person 输入被拒绝", async () => {
    const binding = await getUserBinding(await getAdminUserId());
    const bad = await addPerson(binding.familyId!, { displayName: "" });
    expect(bad).toEqual({ ok: false, error: "invalid_input" });
    const badDate = await addPerson(binding.familyId!, {
      displayName: "某人",
      birthDate: "2026-02-30",
    });
    expect(badDate).toEqual({ ok: false, error: "invalid_input" });
  });

  it("bindUserToPerson 拒绝其他家庭的 Person", async () => {
    const db = getDb();
    const binding = await getUserBinding(await getAdminUserId());
    // 直接在库外另造一个家庭与 Person（模拟 Family B）
    const otherFamilyId = "other-family-0000";
    const otherPersonId = "other-person-0000";
    await db.run(
      sql`INSERT INTO family (id, name, timezone, created_at, updated_at) VALUES (${otherFamilyId}, '别人家', 'Asia/Shanghai', 0, 0)`,
    );
    await db.run(
      sql`INSERT INTO person (id, family_id, display_name, is_child, created_at, updated_at) VALUES (${otherPersonId}, ${otherFamilyId}, '陌生人', 0, 0, 0)`,
    );
    const ok = await bindUserToPerson(
      await getAdminUserId(),
      binding.familyId!,
      otherPersonId,
    );
    expect(ok).toBe(false);
    // 绑定自己的家庭内 Person 成功
    const people = await listPeople(binding.familyId!);
    const grandma = people.find((p) => p.displayName === "外婆")!;
    const ok2 = await bindUserToPerson(
      await getAdminUserId(),
      binding.familyId!,
      grandma.id,
    );
    expect(ok2).toBe(true);
    const after = await getUserBinding(await getAdminUserId());
    expect(after.personId).toBe(grandma.id);
  });
});

describe("家庭数据隔离基础", () => {
  it("listPeople 只返回本家庭成员", async () => {
    const binding = await getUserBinding(await getAdminUserId());
    const people = await listPeople(binding.familyId!);
    const all = await getDb().select({ id: person.id }).from(person);
    // 库里存在两个家庭（我们 + 别人家），但查询只看到自己的
    expect(all.length).toBeGreaterThan(people.length);
    for (const p of people) {
      expect(p.familyId).toBe(binding.familyId);
    }
  });
});

describe("日期校验", () => {
  it("isValidDateString 拒绝非法日期", () => {
    expect(isValidDateString("2026-08-10")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-8-10")).toBe(false);
    expect(isValidDateString("")).toBe(false);
  });
});
