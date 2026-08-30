#!/usr/bin/env node
// 部署冒烟（RH-007）：在部署服务器上运行，验证实例健康。
//
//   node scripts/smoke-deployment.mjs                        # 基础检查（无需凭据）
//   SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/smoke-deployment.mjs   # 附加登录/上传/媒体/导出检查
//
// 环境变量：BASE_URL（默认 http://localhost:3000）、DATA_DIR（默认 ./data，检查可写）
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const require = createRequire(import.meta.url);

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

  // 导出依赖（archiver/jszip 已安装且可加载）
  try {
    require.resolve("archiver");
    require.resolve("jszip");
    ok("导出依赖（archiver/jszip）已安装");
  } catch (err) {
    fail(`导出依赖缺失: ${err.message}`);
  }

  // DATA_DIR 可写
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const probe = path.join(mkdtempSync(path.join(DATA_DIR, "smoke-")), "probe.txt");
    writeFileSync(probe, "ok");
    rmSync(path.dirname(probe), { recursive: true, force: true });
    ok(`DATA_DIR 可写（${DATA_DIR}）`);
  } catch (err) {
    fail(`DATA_DIR 不可写（${DATA_DIR}）: ${err.message}`);
  }

  // ---- 可选：带凭据的深度检查 ----
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password) {
    console.log("\n· 跳过登录/上传/导出检查（设置 SMOKE_EMAIL / SMOKE_PASSWORD 启用）");
    return summary();
  }

  // 登录
  const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  if (signIn.status !== 200) {
    fail(`登录失败 → ${signIn.status}（检查 SMOKE_EMAIL/SMOKE_PASSWORD）`);
    return summary();
  }
  const cookie = (signIn.headers.getSetCookie?.() ?? [])
    .find((c) => c.includes("better-auth.session_token"))
    ?.split(";")[0];
  check(Boolean(cookie), "登录成功（会话 cookie 下发）", "未取到会话 cookie");

  // 上传一张最小 JPEG
  const jpeg = Buffer.concat([
    Buffer.from("ffd8ffe000104a46494600010100000100010000", "hex"),
    Buffer.from("ffd9", "hex"),
  ]);
  const form = new FormData();
  form.append("file", new Blob([jpeg], { type: "image/jpeg" }), "smoke.jpg");
  form.append("lastModified", String(Date.now()));
  const upload = await fetch(`${BASE}/api/upload/image`, {
    method: "POST",
    headers: { cookie, Origin: BASE },
    body: form,
  });
  const uploaded = await upload.json().catch(() => ({}));
  if (upload.status === 201 && uploaded.assetId) {
    ok(`测试图片上传成功（assetId ${uploaded.assetId.slice(0, 8)}…）`);

    // 媒体读取 + Range
    const media = await fetch(`${BASE}/api/media/${uploaded.assetId}`, { headers: { cookie } });
    check(media.status === 200, "媒体读取 → 200", `媒体读取 → ${media.status}`);
    const range = await fetch(`${BASE}/api/media/${uploaded.assetId}`, {
      headers: { cookie, Range: "bytes=0-3" },
    });
    check(
      range.status === 206,
      "媒体 Range 请求 → 206",
      `媒体 Range → ${range.status}（应为 206）`,
    );

    // 导出
    const exp = await fetch(`${BASE}/api/export`, { headers: { cookie } });
    check(
      exp.status === 200 && exp.headers.get("content-type") === "application/zip",
      "完整导出 → 200 application/zip",
      `导出 → ${exp.status}`,
    );
  } else {
    fail(`测试图片上传失败 → ${upload.status} ${JSON.stringify(uploaded).slice(0, 120)}`);
  }

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
