import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getAppVersion } from "@/lib/export/service";

/**
 * GET /api/health —— 部署冒烟（RH-007）。
 * 公开端点但零数据泄露：只报告数据库连通与应用版本。
 */
export async function GET() {
  let dbOk = false;
  try {
    await getDb().run(sql`SELECT 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return Response.json(
    { ok: dbOk, db: dbOk ? "ok" : "error", version: getAppVersion() },
    { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
