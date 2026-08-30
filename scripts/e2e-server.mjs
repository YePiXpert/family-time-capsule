#!/usr/bin/env node
// Playwright webServer：为每个 project 启动一个隔离实例。
// 环境变量：PORT（默认 3100）、E2E_DATA_DIR（默认 data/e2e，每次运行前清空）。
// 测试进程与本脚本使用相同的默认 token/secret，保证两边一致。
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ?? "3100";
const dataDirName = process.env.E2E_DATA_DIR ?? "e2e";
const e2eDataDir = path.join(root, "data", dataDirName);
rmSync(e2eDataDir, { recursive: true, force: true });
mkdirSync(e2eDataDir, { recursive: true });

const env = {
  ...process.env,
  DATA_DIR: e2eDataDir,
  BETTER_AUTH_URL: `http://localhost:${port}`,
  AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-test-auth-secret-0123456789abcdef",
  INITIAL_SETUP_TOKEN: process.env.INITIAL_SETUP_TOKEN ?? "e2e-setup-token",
  // e2e 多个 spec 各自登录，会撞 better-auth 的 /sign-in 默认限流（10s 3 次）
  AUTH_SIGNIN_RATE_LIMIT_MAX: process.env.AUTH_SIGNIN_RATE_LIMIT_MAX ?? "100",
};

// 直接用当前 node 启动 next 的 bin，避免 npx/.cmd/shell 的跨平台问题
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "--port", port], {
  cwd: root,
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
