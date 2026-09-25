import { defineConfig } from "vitest/config";

// 性能基准单独跑，不进 npm test：
//   TMPDIR=/var/tmp/anan-tests npx vitest run -c vitest.perf.config.mts
//   PERF_SIZES=1000,10000 ... 只跑小规模；PERF_JITLESS=1 近似 Hermes（无 JIT）。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/perf/**/*.perf.ts"],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60 * 60 * 1000,
    // 一次一个文件：并行会互相抢 CPU，计时就不准了。
    fileParallelism: false,
    env: { TZ: "Asia/Shanghai" },
    // PERF_JITLESS=1：只给跑测试的子进程加 --jitless（vite 本身要 WebAssembly，不能整体关 JIT）。
    ...(process.env.PERF_JITLESS ? { execArgv: ["--jitless"] } : {}),
  },
});
