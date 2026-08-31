import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-onboarding-guardian-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "guardian-onboarding-token";
process.env.AUTH_SECRET = "guardian-onboarding-secret-0123456789";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("@/db");
const { user } = await import("@/db/schema/auth");
const { performSetup } = await import("@/lib/auth/setup");
const { addPerson, completeOnboarding, getUserBinding, listPeople } =
  await import("@/lib/family/service");

describe("explicit onboarding guardian choice", () => {
  it("persists an explicit choice and never infers it from relationship labels", async () => {
    const setup = await performSetup({
      token: "guardian-onboarding-token",
      displayName: "妈妈",
      email: "guardian-onboarding@example.com",
      password: "guardian-onboarding-password",
    });
    expect(setup).toEqual({ ok: true });
    const admin = getDb()
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "guardian-onboarding@example.com"))
      .get()!;
    const onboarding = await completeOnboarding(admin.id, {
      familyName: "监护人选择家庭",
      timezone: "Asia/Shanghai",
      childDisplayName: "孩子",
      childBirthDate: "2020-01-02",
      selfDisplayName: "妈妈",
      selfRelationToChild: "妈妈",
      selfIsGuardian: true,
    });
    expect(onboarding.ok).toBe(true);
    if (!onboarding.ok) return;
    await expect(getUserBinding(admin.id)).resolves.toMatchObject({
      isGuardian: true,
    });

    const labeledParent = await addPerson(onboarding.familyId, {
      displayName: "另一位爸爸",
      relationToChild: "爸爸",
    });
    expect(labeledParent.ok).toBe(true);
    const people = await listPeople(onboarding.familyId);
    expect(
      people.find((member) => member.displayName === "另一位爸爸"),
    ).toMatchObject({ relationToChild: "爸爸", isGuardian: false });
  });
});
