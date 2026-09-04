import { describe, expect, it } from "vitest";
import { runBoundedImportPool } from "@/lib/imports/pool";

describe("batch import concurrency", () => {
  it("never runs more than three of 100 files and keeps going after one failure", async () => {
    let active = 0;
    let peak = 0;
    const visited: number[] = [];
    const results = await runBoundedImportPool(
      Array.from({ length: 100 }, (_, index) => index),
      3,
      async (index) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        visited.push(index);
        if (index === 37) throw new Error("one file failed");
      },
    );
    expect(peak).toBe(3);
    expect(visited).toHaveLength(100);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(99);
    expect(results[37].status).toBe("rejected");
  });
});
