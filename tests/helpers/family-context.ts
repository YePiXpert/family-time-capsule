import type { FamilyContext } from "@/lib/family/context";
/** Real fixture account bindings; do not hard-code the setup owner's old role. */
export async function testFamilyContext(userId: string, familyId: string): Promise<FamilyContext> {
  const { getLiveFamilyPrincipal } = await import("@/lib/authz/principal");
  return { ...await getLiveFamilyPrincipal(userId, familyId), userName: "合成测试账号" };
}
