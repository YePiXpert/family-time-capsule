import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")("restores real instance archives atomically and preserves original bytes and private ownership", () => {
  const result = spawnSync("python3", ["tests/ops/snapshot_test.py"], { encoding: "utf8", timeout: 60_000 });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
