import { pendingImports } from "./pending";
import "server-only";
import type { FamilyContext } from "@/lib/family/context";
import { getFamily } from "@/lib/family/service";
import { countInbox } from "@/lib/inbox/service";
import { hasFamilyCapability } from "@/lib/authz/policy";
export async function getHomeDashboard(context: FamilyContext) {
  const [family, count] = await Promise.all([getFamily(context.familyId), hasFamilyCapability(context.role,"inbox:review") ? countInbox(context.familyId) : Promise.resolve(0)]);
  return {family:{name:family?.name ?? "家庭记忆",timezone:context.familyTimezone},capabilities:{canCapture:hasFamilyCapability(context.role,"capture:create")},inbox:{count},pendingImports:pendingImports(context)};
}
