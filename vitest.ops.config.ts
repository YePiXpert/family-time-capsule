import { defineConfig } from "vitest/config";

// 运维脚本套件：真实执行 bash 脚本，docker/curl 用假体（tests/ops/fake-docker.sh）。
export default defineConfig({
  test: {
    include: ["tests/ops/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
