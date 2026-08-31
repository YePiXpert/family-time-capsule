#!/usr/bin/env tsx
// 管理员归档恢复 CLI（RH-004，docs/RESTORE.md）：
//   DATA_DIR=/path/to/instance npm run restore -- backup.zip [--user <userId>]
//
// 前置条件：
//   1. 目标实例已通过 /setup 创建管理员（认证数据不来自备份）；
//   2. 实例内没有 Family（只允许恢复到空环境，禁止 merge）。
// 恢复后：管理员登录 → /onboarding 选择「你是谁」完成绑定。
import { asc } from "drizzle-orm";
import { getDb, closeDatabase } from "@/db";
import { user as userTable } from "@/db/schema/auth";
import { restoreFromZipFile, RestoreError } from "@/lib/restore/service";

async function main() {
  const args = process.argv.slice(2);
  let zipPath: string | undefined;
  let explicitUser: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--user") {
      const value = args[++i];
      if (!value || value.startsWith("--")) {
        console.error("✗ --user 必须提供 userId");
        process.exitCode = 2;
        return;
      }
      explicitUser = value;
    } else if (arg.startsWith("--")) {
      console.error(`✗ 未知参数: ${arg}`);
      process.exitCode = 2;
      return;
    } else if (!zipPath) {
      zipPath = arg;
    } else {
      console.error(`✗ 多余参数: ${arg}`);
      process.exitCode = 2;
      return;
    }
  }

  if (!zipPath) {
    console.error("用法: npm run restore -- <backup.zip> [--user <userId>]");
    process.exitCode = 2;
    return;
  }

  const db = getDb();
  try {
    const users = await db
      .select({ id: userTable.id, email: userTable.email })
      .from(userTable)
      .orderBy(asc(userTable.createdAt));
    if (users.length === 0) {
      console.error(
        "✗ 实例中没有任何用户。请先访问 /setup 创建管理员（INITIAL_SETUP_TOKEN），再执行恢复。",
      );
      process.exitCode = 1;
      return;
    }

    // An explicit operator is authoritative. Never fall back to the first user:
    // a typo must fail before the archive is opened or restore writes begin.
    const operator = explicitUser
      ? users.find((candidate) => candidate.id === explicitUser)
      : users[0];
    if (!operator) {
      console.error(`✗ 指定的 --user 不存在: ${explicitUser}`);
      process.exitCode = 1;
      return;
    }
    console.log(`操作者: ${operator.email}`);

    const report = await restoreFromZipFile(zipPath, operator.id);
    console.log("✓ 恢复完成：");
    console.log(`  家庭     ${report.familyId}`);
    console.log(`  成员     ${report.people}`);
    console.log(`  素材     ${report.assets}（文件 ${report.filesWritten}）`);
    console.log(`  事件     ${report.events}`);
    console.log(`  讲述     ${report.contributions}`);
    console.log(`  事实     ${report.facts}`);
    console.log(`  胶囊     ${report.capsules}`);
    console.log("\n下一步：管理员登录后访问 /onboarding 选择「你是谁」完成绑定。");
  } catch (err) {
    if (err instanceof RestoreError) {
      console.error(`✗ 恢复失败 [${err.code}]: ${err.message}`);
      console.error("  数据库未产生半恢复状态，可修正问题后重试。");
    } else {
      console.error("✗ 恢复失败:", err);
    }
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
}

main().catch((err) => {
  closeDatabase();
  console.error("✗ 恢复 CLI 异常:", err);
  process.exitCode = 1;
});
