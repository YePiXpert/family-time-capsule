import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "tests/mocks/server-only.ts"),
      "expo-sqlite": path.resolve(__dirname, "tests/mocks/expo-sqlite.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    // Integration suites own process-global DATA_DIR/database singletons. A single
    // worker keeps those boundaries deterministic and avoids native SQLite cleanup
    // races when fork workers exit concurrently on Node 24.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
