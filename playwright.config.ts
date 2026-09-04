import { defineConfig, devices } from "@playwright/test";

/**
 * RH-006：E2E 独立性。
 * 每个 project 一个独立 webServer（独立端口 + 独立 DATA_DIR），
 * spec 之间零共享状态——任何 spec 可单独执行：
 *   npx playwright test timeline.spec.ts
 * 业务状态由各 spec 自行 bootstrap（helpers.ts）。
 * full-journey.spec.ts 保留完整用户旅程。
 */

const specs = [
  { name: "auth", files: ["auth.spec.ts", "pwa.spec.ts"], port: 3110 },
  { name: "upload", files: ["upload.spec.ts"], port: 3111 },
  { name: "av", files: ["av.spec.ts"], port: 3112 },
  { name: "merge", files: ["merge.spec.ts"], port: 3113 },
  { name: "timeline", files: ["timeline.spec.ts"], port: 3114 },
  { name: "contribution", files: ["contribution.spec.ts"], port: 3115 },
  { name: "capsule", files: ["capsule.spec.ts"], port: 3116 },
  { name: "export", files: ["export.spec.ts"], port: 3117 },
  { name: "journey", files: ["full-journey.spec.ts"], port: 3118 },
  { name: "edit", files: ["edit.spec.ts"], port: 3119 },
  { name: "rbac", files: ["rbac.spec.ts"], port: 3120 },
  { name: "invitations", files: ["invitations.spec.ts"], port: 3121 },
  { name: "inbox-draft", files: ["inbox-draft.spec.ts"], port: 3123 },
  {
    name: "ai",
    files: ["ai.spec.ts"],
    port: 3122,
    env: {
      AI_PROVIDER: "openai-compatible",
      AI_BASE_URL: "http://127.0.0.1:3999/v1",
      AI_API_KEY: "e2e-not-a-real-provider-key",
      AI_PROVIDER_LABEL: "E2E local-compatible mock",
      AI_MODEL: "e2e-text-model",
    },
  },
];

// A targeted `--project=<exact-name>` run only needs that project's server.
// Keeping unrelated Next processes out of focused runs also makes Windows
// teardown deterministic. Pattern/unknown project selectors fall back to all.
const requestedProjectNames = new Set<string>();
for (let index = 0; index < process.argv.length; index += 1) {
  const argument = process.argv[index]!;
  if (argument === "--project" && process.argv[index + 1]) {
    requestedProjectNames.add(process.argv[index + 1]!);
    index += 1;
  } else if (argument.startsWith("--project=")) {
    requestedProjectNames.add(argument.slice("--project=".length));
  }
}
const requestedServerSpecs = specs.filter((spec) =>
  requestedProjectNames.has(spec.name),
);
const serverSpecs =
  requestedProjectNames.size > 0 &&
  requestedServerSpecs.length === requestedProjectNames.size
    ? requestedServerSpecs
    : specs;

export default defineConfig({
  testDir: "tests/e2e",
  // 各 project 数据隔离，project 间可并行；project 内 serial（共享同一 DB）
  workers: process.env.CI ? 3 : 2,
  timeout: 45_000,
  // CI 上 12 个独立 server 共享 runner，SSR 渲染偶发超过默认 5s——
  // 只放宽等待预算，不放宽断言内容
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  webServer: serverSpecs.map((s) => ({
    command: "node scripts/e2e-server.mjs",
    url: `http://localhost:${s.port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 3_000 },
    env: {
      PORT: String(s.port),
      E2E_DATA_DIR: `e2e-${s.name}`,
      ...("env" in s ? s.env : {}),
    },
  })),
  projects: specs.map((s) => ({
    name: s.name,
    testMatch: s.files.map((f) => new RegExp(f.replace(".", "\\."))),
    use: { baseURL: `http://localhost:${s.port}`, ...devices["Desktop Chrome"] },
  })),
});
