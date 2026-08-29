#!/usr/bin/env node
// Playwright webServer：用隔离的 DATA_DIR（data/e2e，每次运行前清空）启动生产构建。
// 测试进程与本脚本使用相同的默认 token/secret，保证两边一致。
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const e2eDataDir = path.join(root, "data", "e2e");
rmSync(e2eDataDir, { recursive: true, force: true });
mkdirSync(e2eDataDir, { recursive: true });

const env = {
  ...process.env,
  DATA_DIR: e2eDataDir,
  BETTER_AUTH_URL: "http://localhost:3100",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-test-auth-secret-0123456789abcdef",
  INITIAL_SETUP_TOKEN: process.env.INITIAL_SETUP_TOKEN ?? "e2e-setup-token",
};

// 直接用当前 node 启动 next 的 bin，避免 npx/.cmd/shell 的跨平台问题
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "--port", "3100"], {
  cwd: root,
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
