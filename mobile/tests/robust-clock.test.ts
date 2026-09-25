import { expect, it, vi } from "vitest";
vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "x" }));
vi.mock("expo-sharing", () => ({}));
vi.mock("expo-image-manipulator", () => ({}));
vi.mock("expo-video-thumbnails", () => ({}));
it("treats a last-backup time that lies in the future (clock was ahead, then corrected) as unknown, not as '-N days ago'", async () => {
  const { daysSinceExport } = await import("../src/local/backup");
  const { backupDueOf } = await import("../src/local/nudge");
  const { backupLine } = await import("../src/local/settings-lines");
  const today = new Date(2026, 8, 25, 12);
  // Saved while the phone's clock said 2027-03-01.
  const state = { lastExportAt: new Date(2027, 2, 1, 9).toISOString() };
  const days = daysSinceExport(state, today);
  // Today: -157 → Settings shows 「上次完整备份 -157 天前」 and the shelf backup reminder stays
  // silent for 187 days, although no backup exists since the clock was fixed.
  expect(backupLine(days, 0)).not.toMatch(/-\d/);
  expect(backupDueOf(new Date(2026, 0, 1).toISOString(), days, today)).toBe(true);
});
