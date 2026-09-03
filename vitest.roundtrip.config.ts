import path from "node:path";
import { defineConfig } from "vitest/config";

// 灾难恢复 roundtrip（RH-005）：依赖生产构建（spawn next start），
// 由 `npm run test:e2e` 在 playwright 之后运行，不参与普通 `npm test`。
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "tests/mocks/server-only.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["tests/roundtrip/**/*.test.ts"],
    environment: "node",
    testTimeout: 240_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
