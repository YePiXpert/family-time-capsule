import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export type RestoredPrincipal = { archivePrincipalId: string; userId: string; name: string; state: "unresolved" | "bound" };
/** Host maintenance inventory. Never expose this as an ordinary account-management API. */
export function listRestoredPrincipals(familyId: string): RestoredPrincipal[] {
  return getDb().all(sql`select r.archive_principal_id archivePrincipalId,r.user_id userId,u.name,r.state from restore_principal r join user u on u.id=r.user_id where r.family_id=${familyId} order by r.archive_principal_id`);
}
/**
 * Explicit host-authorized identity recovery. Matching a Person/name never calls
 * this function. No credentials or account roles are copied from the archive.
 */
export function bindRestoredPrincipal(familyId: string, archivePrincipalId: string, targetUserId: string, operatorUserId: string) {
  return getDb().transaction(tx => {
    const principal = tx.get<{ id: string; userId: string; state: string }>(sql`select id,user_id userId,state from restore_principal where family_id=${familyId} and archive_principal_id=${archivePrincipalId}`);
    if (!principal) throw new Error("restore_principal_not_found");
    const actor = tx.get(sql`select id from user where id=${operatorUserId} and family_id=${familyId} and role in ('owner','admin') and disabled_at is null`);
    const target = tx.get(sql`select id from user where id=${targetUserId} and family_id=${familyId} and disabled_at is null`);
    if (!actor || !target) throw new Error("restore_principal_invalid_account");
    if (principal.state === "bound") {
      if (principal.userId === targetUserId) return { state: "bound" as const, changed: false };
      throw new Error("restore_principal_already_bound");
    }
    const previous = principal.userId;
    const placeholder = tx.get(sql`select id from user where id=${previous} and disabled_at is not null and person_id is null`);
    if (!placeholder) throw new Error("restore_principal_invalid_placeholder");
    tx.run(sql`update memory_event set created_by_user_id=${targetUserId} where family_id=${familyId} and created_by_user_id=${previous}`);
    tx.run(sql`update asset set created_by_user_id=${targetUserId} where family_id=${familyId} and created_by_user_id=${previous}`);
    tx.run(sql`update draft set author_user_id=${targetUserId} where family_id=${familyId} and author_user_id=${previous}`);
    tx.run(sql`update draft set reader_user_ids_json=(select json_group_array(value) from (select distinct case when value=${previous} then ${targetUserId} else value end value from json_each(draft.reader_user_ids_json))) where family_id=${familyId} and exists(select 1 from json_each(draft.reader_user_ids_json) where value=${previous})`);
    tx.run(sql`delete from memory_event_reader where family_id=${familyId} and user_id=${previous} and exists(select 1 from memory_event_reader other where other.family_id=${familyId} and other.memory_event_id=memory_event_reader.memory_event_id and other.user_id=${targetUserId})`);
    tx.run(sql`update memory_event_reader set user_id=${targetUserId} where family_id=${familyId} and user_id=${previous}`);
    tx.run(sql`update book_project set owner_user_id=${targetUserId} where family_id=${familyId} and owner_user_id=${previous}`);
    tx.run(sql`update import_session set created_by_user_id=${targetUserId} where family_id=${familyId} and created_by_user_id=${previous}`);
    tx.run(sql`update restore_principal set user_id=${targetUserId},state='bound',bound_at=${Date.now()} where id=${principal.id}`);
    tx.run(sql`insert into audit_log(id,family_id,kind,actor_user_id,detail_json,created_at) values (${randomUUID()},${familyId},'restore.principal_bound',${operatorUserId},${JSON.stringify({ archivePrincipalId, previousUserId: previous, targetUserId })},${Math.floor(Date.now()/1000)})`);
    return { state: "bound" as const, changed: true };
  }, { behavior: "immediate" });
}
