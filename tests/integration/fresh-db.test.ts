import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * 冷启动验证（迁移纪律）：空 DATA_DIR → 打开数据库 → 全部 migration 自动应用
 * → 18 张表齐备 → setup 流程可用（#018 / PRD §27）。
 */

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-fresh-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "fresh-token";
process.env.AUTH_SECRET = "fresh-secret";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { sql } = await import("drizzle-orm");

describe("fresh database 冷启动", () => {
  it("空 DATA_DIR 首次连接即应用全部 migration（18 张表）", async () => {
    const { getDb } = await import("@/db");
    const db = getDb(); // 模块导入即触发迁移
    const rows = (await db.all(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    )) as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    const expected = [
      "user",
      "session",
      "account",
      "verification",
      "family",
      "person",
      "asset",
      "inbox_item",
      "inbox_item_asset",
      "memory_event",
      "memory_event_asset",
      "memory_event_participant",
      "contribution",
      "fact",
      "capsule",
      "capsule_asset",
      "capsule_event",
      "capsule_contribution",
    ];
    for (const table of expected) {
      expect(names, `missing table: ${table}`).toContain(table);
    }
  });

  it("setup 在空库上可用（bootstrap→初始化闭环）", async () => {
    const { getSetupState, performSetup } = await import("@/lib/auth/setup");
    const state = await getSetupState();
    expect(state.hasUsers).toBe(false);
    const result = await performSetup({
      token: "fresh-token",
      displayName: "爸爸",
      email: "fresh@example.com",
      password: "a-long-enough-password",
    });
    expect(result).toEqual({ ok: true });
    expect((await getSetupState()).hasUsers).toBe(true);
  });
});
