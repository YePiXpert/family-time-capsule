import { describe, expect, it } from "vitest";
import {
  changeAvgMs,
  emptyHealth,
  normalizeHealth,
  recordChange,
  recordDiskFailure,
  recordLaunch,
} from "../src/local/health";
import { LocalStore } from "../src/local/store";
import { emptyLibrary } from "../src/local/model";

describe("local health stats", () => {
  it("averages and maxes successful change durations", () => {
    let h = emptyHealth();
    h = recordChange(h, 4);
    h = recordChange(h, 11);
    expect(h.changeCount).toBe(2);
    expect(changeAvgMs(h)).toBe(7.5);
    expect(h.changeMaxMs).toBe(11);
  });
  it("counts launches with the latest duration", () => {
    let h = emptyHealth();
    h = recordLaunch(h, 812, "2026-09-18T02:00:00.000Z");
    h = recordLaunch(h, 640, "2026-09-19T02:00:00.000Z");
    expect(h.launches).toBe(2);
    expect(h.lastLaunchMs).toBe(640);
    expect(h.lastLaunchAt).toBe("2026-09-19T02:00:00.000Z");
  });
  it("keeps a bounded recent error summary", () => {
    let h = emptyHealth();
    h = recordDiskFailure(h, "x".repeat(500), "2026-09-18T02:00:00.000Z");
    expect(h.diskFailures).toBe(1);
    expect(h.lastDiskError).toHaveLength(200);
    h = recordDiskFailure(h, "disk full", "2026-09-18T03:00:00.000Z");
    expect(h.lastDiskError).toBe("disk full");
    expect(h.lastDiskErrorAt).toBe("2026-09-18T03:00:00.000Z");
  });
  it("normalizes old or broken files back to safe defaults", () => {
    expect(normalizeHealth(null)).toEqual(emptyHealth());
    expect(normalizeHealth({ version: 1, launches: -3, changeMaxMs: "big" })).toEqual(
      emptyHealth(),
    );
    const kept = normalizeHealth({
      version: 1,
      launches: 7,
      lastLaunchMs: 900,
      lastLaunchAt: "2026-09-18T02:00:00.000Z",
      lastDiskError: 42,
    });
    expect(kept.launches).toBe(7);
    expect(kept.lastDiskError).toBeNull();
  });
  it("reports write failures without blocking later writes", async () => {
    let fail = true;
    const changes: number[] = [],
      failures: string[] = [];
    const store = new LocalStore(
      {
        read: async () => emptyLibrary(),
        write: async () => {
          if (fail) throw new Error("disk full");
        },
      },
      {
        onChange: (ms) => changes.push(ms),
        onWriteFailure: (message) => failures.push(message),
      },
    );
    await store.open();
    await expect(
      store.change((s) => {
        s.welcome = true;
      }),
    ).rejects.toThrow("disk full");
    expect(store.get().welcome).toBe(false);
    fail = false;
    await store.change((s) => {
      s.welcome = true;
    });
    expect(store.get().welcome).toBe(true);
    // 失败不进耗时统计，成功进。
    expect(failures).toEqual(["disk full"]);
    expect(changes).toHaveLength(1);
  });
});
