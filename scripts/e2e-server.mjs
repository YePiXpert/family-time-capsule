#!/usr/bin/env node
// Playwright webServer: one isolated production Next instance per project.
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portText = process.env.PORT ?? "3100";
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("invalid E2E port");
}
const dataDirName = process.env.E2E_DATA_DIR ?? "e2e";
if (!/^[A-Za-z0-9_-]{1,64}$/u.test(dataDirName)) {
  throw new Error("invalid E2E data directory name");
}
const dataRoot = path.join(root, "data");
const e2eDataDir = path.join(dataRoot, dataDirName);
if (
  !e2eDataDir.startsWith(
    `${dataRoot}${path.sep}`,
  )
) {
  throw new Error("unsafe E2E data directory");
}
rmSync(e2eDataDir, { recursive: true, force: true });
mkdirSync(e2eDataDir, { recursive: true });

Object.assign(process.env, {
  DATA_DIR: e2eDataDir,
  BETTER_AUTH_URL: `http://localhost:${port}`,
  AUTH_SECRET:
    process.env.AUTH_SECRET ?? "e2e-test-auth-secret-0123456789abcdef",
  INITIAL_SETUP_TOKEN:
    process.env.INITIAL_SETUP_TOKEN ?? "e2e-setup-token",
  AUTH_SIGNIN_RATE_LIMIT_MAX:
    process.env.AUTH_SIGNIN_RATE_LIMIT_MAX ?? "100",
});

// Hosting Next directly avoids a wrapper -> child process tree that Windows
// cannot reliably tear down after Playwright completes.
const app = next({ dev: false, dir: root, hostname: "localhost", port });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((request, response) => {
  void handle(request, response);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "0.0.0.0", resolve);
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const forceExit = setTimeout(() => process.exit(0), 2_000);
  await new Promise((resolve) => server.close(resolve));
  await app.close();
  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
