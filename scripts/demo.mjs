#!/usr/bin/env node
// 一键本地演示：确保演示数据存在，然后以演示环境启动 next dev。
// 用法：npm run demo [-- --reset]
// 登录：demo@family.local / demo-family-2026（仅演示目录 demo-data，不影响 ./data）
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "demo-data");
const envFile = path.join(dataDir, "demo-env.json");

if (process.argv.includes("--reset") && existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`已清除演示目录 ${dataDir}`);
}

if (!existsSync(envFile)) {
  console.log("首次运行：生成演示数据（合成插画照片、音频与记忆事件）……");
  const seeded = spawnSync(
    process.execPath,
    ["--import", "tsx", "--conditions=react-server", "scripts/demo-seed.mts"],
    { cwd: root, stdio: "inherit" },
  );
  if (seeded.status !== 0) {
    console.error("演示数据生成失败");
    process.exit(seeded.status ?? 1);
  }
}

const cfg = JSON.parse(readFileSync(envFile, "utf8"));
const port = process.env.DEMO_PORT ?? "3000";
console.log("");
console.log("──────────────────────────────────────────────");
console.log("  家庭时光胶囊 · 本地演示");
console.log(`  地址：http://localhost:${port}/login`);
console.log(`  账号：${cfg.email}`);
console.log(`  密码：${cfg.password}`);
console.log("  数据：demo-data/（合成数据，随时 npm run demo -- --reset 重建）");
console.log("──────────────────────────────────────────────");

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    AUTH_SECRET: cfg.authSecret,
    BETTER_AUTH_URL: `http://localhost:${port}`,
  },
});
// 演示也要跑 worker：图片预览、音频波形等衍生任务由它处理，否则客户端会一直等。
const worker = spawn(
  process.execPath,
  ["--import", "tsx", "--conditions=react-server", "jobs/worker.ts"],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      AUTH_SECRET: cfg.authSecret,
    },
  },
);
const children = [child, worker];
const shutdown = () => {
  for (const c of children) c.kill();
};
child.on("exit", code => {
  worker.kill();
  process.exit(code ?? 0);
});
worker.on("exit", () => {
  // worker 意外退出不拖垮演示页面，但提示一下衍生任务会停在排队。
  console.error("[demo] worker 已退出；图片预览/音频波形将不再生成。");
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, shutdown);
}
