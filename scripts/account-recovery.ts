// 本机受审计账号恢复 CLI（ID-7/OPS-5）。
// 只在部署服务器上由维护者本人运行；不暴露任何 HTTP 入口。
//
//   DATA_DIR=/srv/family-time-capsule/data npm run recover-account -- --email admin@example.com [--origin https://family.example.com]
//
// 输出一次性恢复链接（15 分钟内有效）。令牌只存 SHA-256；使用一次即作废，
// 并撤销该账号全部会话。审计写入实例 audit_log（account.recovery_token_issued）。

import { issueAccountRecoveryToken } from "@/lib/auth/account-recovery";
import { getDb } from "@/db";

function usage(): never {
  console.error(
    "用法：npm run recover-account -- --email <账号邮箱> [--origin https://家庭实例域名]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): { email?: string; origin?: string } {
  const parsed: { email?: string; origin?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--email" && argv[index + 1]) {
      parsed.email = argv[++index]!;
    } else if (argument === "--origin" && argv[index + 1]) {
      parsed.origin = argv[++index]!;
    } else {
      usage();
    }
  }
  return parsed;
}

async function main() {
  const { email, origin } = parseArgs(process.argv.slice(2));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) usage();
  if (!process.env.DATA_DIR) {
    console.error(
      "需要显式 DATA_DIR 指向实例数据目录（例如 /srv/family-time-capsule/data），拒绝在默认位置猜测。",
    );
    process.exit(2);
  }
  if (origin && !/^https:\/\/[^\s/?#]+$/u.test(origin)) {
    console.error("--origin 必须是形如 https://family.example.com 的 HTTPS 地址。");
    process.exit(2);
  }

  const result = issueAccountRecoveryToken({ email });
  if (!result.ok) {
    if (result.error === "user_not_found") {
      console.error(`未找到账号 ${email}。请确认邮箱与实例数据库（DATA_DIR）。`);
    } else {
      console.error(`账号 ${email} 已被停用；请先由管理员恢复该账号。`);
    }
    process.exit(1);
  }
  // 预热数据库连接，确保进程退出前写入完成
  getDb();
  const path =
    origin && /^https:\/\//u.test(origin)
      ? `${origin}/recover/${encodeURIComponent(result.token)}`
      : null;
  console.log("一次性恢复链接已生成（15 分钟内有效，仅可使用一次）：\n");
  console.log(`  令牌：${result.token}`);
  if (path) console.log(`  链接：${path}`);
  console.log(
    "\n请通过可信渠道交给账号主人。此令牌只存哈希，无法再次显示；过期请在服务器重新生成。",
  );
  process.exit(0);
}

void main();
