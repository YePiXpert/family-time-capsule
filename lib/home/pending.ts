import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { FamilyContext } from "@/lib/family/context";

export function pendingImports(context: FamilyContext): { id: string; title: string }[] {
  return getDb().all<{ id: string; title: string }>(sql`select id,coalesce(nullif(default_title,''),'未完成导入') title
    from import_session where family_id=${context.familyId} and created_by_user_id=${context.userId}
      and status<>'cancelled' and total_count>0 and (failed_count>0 or status='collecting')
    order by updated_at desc,id desc limit 100`);
}
