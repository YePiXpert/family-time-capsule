#!/usr/bin/env node
// 部署冒烟（RH-007）：在部署服务器上运行，验证实例健康。
//
//   node scripts/smoke-deployment.mjs                        # 基础检查（无需凭据）
//   SMOKE_SESSION_COOKIE='better-auth.session_token=…' node scripts/smoke-deployment.mjs
//       # 附加只读认证检查；复用现有会话，不创建测试账号/会话/业务数据
//
// 环境变量：BASE_URL（默认 http://localhost:3000）、DATA_DIR（默认 ./data，检查可写）
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

let failed = 0;
function ok(msg) {
  console.log(`✓ ${msg}`);
}
function fail(msg) {
  failed++;
  console.error(`✗ ${msg}`);
}
function check(cond, okMsg, failMsg) {
  if (cond) ok(okMsg);
  else fail(failMsg);
}

async function main() {
  console.log(`Smoke target: ${BASE}\n`);

  // ---- 无需凭据的基础检查 ----
  const login = await fetch(`${BASE}/login`);
  check(login.status === 200, "GET /login → 200", `GET /login → ${login.status}`);

  const manifest = await fetch(`${BASE}/manifest.webmanifest`);
  check(manifest.status === 200, "PWA manifest → 200", `manifest → ${manifest.status}`);

  const health = await fetch(`${BASE}/api/health`);
  if (health.status === 200) {
    const body = await health.json();
    check(body.db === "ok", `health: db ok, version ${body.version}`, `health: db ${body.db}`);
  } else {
    fail(`GET /api/health → ${health.status}`);
  }

  // 未登录访问私有端点必须 401（安全基线）
  const mediaAnon = await fetch(`${BASE}/api/media/00000000-0000-0000-0000-000000000000`);
  check(
    mediaAnon.status === 401,
    "匿名媒体访问 → 401",
    `匿名媒体访问 → ${mediaAnon.status}（应为 401）`,
  );

  // ffmpeg / ffprobe 可用性（增强能力，缺失仅提示）
  for (const bin of ["ffmpeg", "ffprobe"]) {
    const r = spawnSync(bin, ["-version"], { encoding: "utf8", windowsHide: true });
    if (r.status === 0) ok(`${bin} 可用（${r.stdout.split("\n")[0].slice(0, 60)}…）`);
    else console.log(`· ${bin} 不可用（音视频元数据/转码增强能力降级，不影响上传）`);
  }

  // DATA_DIR 可写
  let probeDir;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    probeDir = mkdtempSync(path.join(DATA_DIR, "smoke-"));
    const probe = path.join(probeDir, "probe.txt");
    writeFileSync(probe, "ok");
    ok(`DATA_DIR 可写（${DATA_DIR}）`);
  } catch (err) {
    fail(`DATA_DIR 不可写（${DATA_DIR}）: ${err.message}`);
  } finally {
    if (probeDir) {
      try {
        rmSync(probeDir, { recursive: true, force: true });
      } catch (err) {
        fail(`DATA_DIR 探针清理失败（${probeDir}）: ${err.message}`);
      }
    }
  }

  // ---- 可选：带凭据的只读检查 ----
  // 生产冒烟必须可重复执行：这里不上传、不创建导出，也不改任何业务数据。
  const sessionCookie = process.env.SMOKE_SESSION_COOKIE;
  if (!sessionCookie) {
    console.log("\n· 跳过只读认证检查（设置 SMOKE_SESSION_COOKIE 复用现有会话）");
    return summary();
  }

  const session = await fetch(`${BASE}/api/auth/get-session`, {
    headers: { cookie: sessionCookie, Origin: ORIGIN },
  });
  const sessionBody = await session.json().catch(() => null);
  check(
    session.status === 200 && Boolean(sessionBody?.user),
    "会话读取成功（只读、无业务数据写入）",
    `会话读取失败 → ${session.status}（检查 SMOKE_SESSION_COOKIE 是否仍有效）`,
  );

  console.log("· 认证冒烟复用现有会话且只读：未创建会话、上传或导出，可安全重复执行");

  return summary();
}

function summary() {
  console.log(`\n结论: ${failed === 0 ? "全部通过 ✓" : `${failed} 项失败 ✗`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("冒烟脚本异常:", err);
  process.exit(1);
});
