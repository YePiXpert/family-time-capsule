/**
 * 极简基准：每项先热身，再跑若干次取中位数（ms）。结果写进 PERF_OUT/<文件>.json，
 * tests/perf/report.mjs 汇总成表。节点 JIT 与手机上的 Hermes 差得远：
 * 用 `PERF_JITLESS=1` 再跑一遍，数字更接近手机（Hermes 同样没有 JIT）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll } from "vitest";

export type Result = {
  group: string;
  op: string;
  size: number | string;
  median: number;
  min: number;
  max: number;
  runs: number;
  note?: string;
};
const results: Result[] = [];

export async function bench(
  group: string,
  op: string,
  size: number | string,
  fn: () => unknown,
  options: {
    runs?: number;
    warmup?: number;
    /** 每次计时前调用、不计时（造新库、开新 store）。返回值传给 fn 前无需，fn 自己闭包取。 */
    setup?: () => unknown;
    note?: string;
  } = {},
): Promise<Result> {
  const times: number[] = [];
  const warmup = options.warmup ?? 1;
  let runs = options.runs ?? 7;
  for (let i = 0; i < warmup + runs; i++) {
    if (options.setup) await options.setup();
    const t0 = performance.now();
    await fn();
    const ms = performance.now() - t0;
    if (i >= warmup) times.push(ms);
    // 慢项自动少跑几次，免得整套跑一小时。
    if (i === 0 && options.runs === undefined) {
      if (ms > 3000) runs = 1;
      else if (ms > 600) runs = 3;
    }
  }
  times.sort((a, b) => a - b);
  const result: Result = {
    group,
    op,
    size,
    median: times[Math.floor(times.length / 2)]!,
    min: times[0]!,
    max: times[times.length - 1]!,
    runs: times.length,
    ...(options.note ? { note: options.note } : {}),
  };
  results.push(result);
  console.log(
    `[perf] ${group} | ${op} | ${size} | median ${result.median.toFixed(2)} ms (min ${result.min.toFixed(2)}, max ${result.max.toFixed(2)}, n=${result.runs})`,
  );
  return result;
}

/** 在测试文件里调一次：结束时把这份文件的结果落盘。 */
export function reportTo(file: string) {
  afterAll(() => {
    const dir = process.env.PERF_OUT ?? path.resolve(process.env.TMPDIR ?? "/var/tmp", "anan-perf-results");
    fs.mkdirSync(dir, { recursive: true });
    const mode = process.execArgv.includes("--jitless") || (process.env.NODE_OPTIONS ?? "").includes("--jitless") ? "jitless" : "jit";
    fs.writeFileSync(
      path.join(dir, `${path.basename(file).replace(/\.perf\.ts$/, "")}.${mode}.json`),
      JSON.stringify(results, null, 1),
    );
  });
}
