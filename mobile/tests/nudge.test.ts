import { describe, expect, it } from "vitest";
import {
  backupDueOf,
  backupNudgeBody,
  bookNudgeOf,
  daysSince,
  nudgeClosed,
  nudgeOf,
  pickNudge,
} from "../src/local/nudge";

// 时间戳一律不带时区后缀：按本地日历日写死，任何时区下断言一致。
const today = new Date(2026, 8, 18);

describe("capture rhythm nudge", () => {
  it("stays quiet without records or within the first three days", () => {
    expect(nudgeOf(null, null, 0, today)).toBeNull();
    expect(nudgeOf("2026-09-16T09:00:00.000", null, 0, today)).toBeNull();
    expect(nudgeOf("2026-09-18T01:00:00.000", null, 0, today)).toBeNull();
  });
  it("counts calendar days and nudges from the third day on", () => {
    expect(daysSince("2026-09-15T23:00:00.000", today)).toBe(3);
    expect(nudgeOf("2026-09-15T23:00:00.000", null, 0, today)).toEqual({
      kind: "days",
      days: 3,
    });
    expect(nudgeOf("2026-09-08T10:00:00.000", null, 0, today)).toEqual({
      kind: "days",
      days: 10,
    });
  });
  it("prioritizes stale drafts over the day counter", () => {
    // 记录已 10 天没写，但草稿昨天刚动过：交给既有草稿入口，不提示。
    expect(
      nudgeOf("2026-09-08T10:00:00.000", "2026-09-17T22:00:00.000", 1, today),
    ).toBeNull();
    // 草稿也放了 3 天：提醒接着写。
    expect(
      nudgeOf("2026-09-17T22:00:00.000", "2026-09-15T08:00:00.000", 2, today),
    ).toEqual({ kind: "draft" });
    expect(nudgeOf(null, null, 1, today)).toEqual({ kind: "draft" });
  });
});

describe("year book binding nudge", () => {
  it("suggests binding last year during January and February", () => {
    expect(bookNudgeOf(new Date(2027, 0, 5), ["2026", "2025"], [])).toEqual({ year: "2026" });
    expect(bookNudgeOf(new Date(2027, 1, 28), ["2026"], ["2025"])).toEqual({ year: "2026" });
  });
  it("stays quiet from March on", () => {
    expect(bookNudgeOf(new Date(2027, 2, 1), ["2026"], [])).toBeNull();
    expect(bookNudgeOf(new Date(2027, 8, 19), ["2026"], [])).toBeNull();
  });
  it("stays quiet once last year's book was bound", () => {
    expect(bookNudgeOf(new Date(2027, 0, 5), ["2026"], ["2026"])).toBeNull();
  });
  it("stays quiet when last year has no records", () => {
    expect(bookNudgeOf(new Date(2027, 0, 5), ["2025"], [])).toBeNull();
    expect(bookNudgeOf(new Date(2027, 0, 5), [], [])).toBeNull();
  });
});

describe("one nudge card at a time", () => {
  const closedNow = "2026-09-18T08:00:00.000";
  it("returns null without candidates", () => {
    expect(pickNudge([], {}, today)).toBeNull();
    expect(pickNudge([], undefined, today)).toBeNull();
  });
  it("orders conflict over signature over milestone over binding over backup over rhythm", () => {
    expect(pickNudge(["rhythm", "milestone", "by", "conflict"], {}, today)).toBe("conflict");
    expect(pickNudge(["rhythm", "milestone", "by"], {}, today)).toBe("by");
    expect(pickNudge(["rhythm", "backup", "book", "milestone"], {}, today)).toBe("milestone");
    expect(pickNudge(["rhythm", "backup", "book"], {}, today)).toBe("book");
    expect(pickNudge(["rhythm", "backup"], {}, today)).toBe("backup");
    expect(pickNudge(["rhythm"], undefined, today)).toBe("rhythm");
  });
  it("falls through to the next candidate when the top one was closed", () => {
    expect(
      pickNudge(["milestone", "backup", "rhythm"], { milestone: closedNow }, today),
    ).toBe("backup");
    expect(
      pickNudge(["backup", "rhythm"], { backup: closedNow, rhythm: closedNow }, today),
    ).toBeNull();
  });
  it("silences milestone and rhythm cards for the day only", () => {
    expect(nudgeClosed("milestone", closedNow, today)).toBe(true);
    expect(nudgeClosed("rhythm", "2026-09-18T23:59:00.000", today)).toBe(true);
    expect(nudgeClosed("rhythm", "2026-09-17T23:59:00.000", today)).toBe(false);
    expect(nudgeClosed("milestone", "2026-09-17T09:00:00.000", today)).toBe(false);
  });
  it("silences the signature card forever and the conflict card for today", () => {
    expect(nudgeClosed("by", "2020-01-01T09:00:00.000", today)).toBe(true);
    expect(nudgeClosed("by", undefined, today)).toBe(false);
    expect(nudgeClosed("conflict", closedNow, today)).toBe(true);
    expect(nudgeClosed("conflict", new Date(today.getTime() - 86400000).toISOString(), today)).toBe(false);
    expect(pickNudge(["conflict", "by"], {}, today)).toBe("conflict");
    expect(pickNudge(["by", "rhythm"], { by: "2020-01-01T09:00:00.000" }, today)).toBe("rhythm");
    expect(pickNudge(["conflict"], { conflict: closedNow }, today)).toBeNull();
  });
  it("silences the backup card for seven days", () => {
    expect(nudgeClosed("backup", "2026-09-12T09:00:00.000", today)).toBe(true);
    expect(nudgeClosed("backup", "2026-09-11T09:00:00.000", today)).toBe(false);
    expect(pickNudge(["backup"], { backup: "2026-09-11T09:00:00.000" }, today)).toBe("backup");
  });
  it("silences the binding card for the rest of the quarter", () => {
    const january = new Date(2027, 0, 20);
    expect(nudgeClosed("book", "2027-01-05T09:00:00.000", january)).toBe(true);
    expect(nudgeClosed("book", "2027-01-05T09:00:00.000", new Date(2027, 1, 28))).toBe(true);
    expect(nudgeClosed("book", "2027-01-05T09:00:00.000", new Date(2027, 3, 1))).toBe(false);
    expect(nudgeClosed("book", "2026-01-05T09:00:00.000", january)).toBe(false);
  });
  it("treats unreadable close times as never closed", () => {
    expect(nudgeClosed("backup", "someday", today)).toBe(false);
    expect(nudgeClosed("backup", undefined, today)).toBe(false);
    expect(pickNudge(["rhythm"], { rhythm: "someday" }, today)).toBe("rhythm");
  });
});


describe("backup reminder recognizes family sync", () => {
  const local = "记录只保存在这台手机上。定期保存一份完整备份，把这段时光留到应用之外。";
  const synced = "同步只把记录放到家里的服务，那不是应用之外的备份。保存一份完整备份，把这段时光留到应用之外。";
  it("uses the synced wording through day seven", () => {
    expect(backupNudgeBody(true, "2026-09-18T09:00:00", today)).toBe(synced);
    expect(backupNudgeBody(true, "2026-09-11T09:00:00", today)).toBe(synced);
  });
  it("keeps the original wording when unjoined, never synced, invalid or older than seven days", () => {
    expect(backupNudgeBody(false, "2026-09-18T09:00:00", today)).toBe(local);
    expect(backupNudgeBody(true, undefined, today)).toBe(local);
    expect(backupNudgeBody(true, "invalid", today)).toBe(local);
    expect(backupNudgeBody(true, "2026-09-10T09:00:00", today)).toBe(local);
  });
});

describe("backup reminder waits for the first week", () => {
  it("stays quiet without records or before the first moment is seven days old", () => {
    expect(backupDueOf(null, null, today)).toBe(false);
    expect(backupDueOf("2026-09-18T08:00:00.000", null, today)).toBe(false);
    expect(backupDueOf("2026-09-12T23:00:00.000", null, today)).toBe(false);
  });
  it("asks from day seven on until an export is at most thirty days old", () => {
    expect(backupDueOf("2026-09-11T09:00:00.000", null, today)).toBe(true);
    expect(backupDueOf("2026-06-01T09:00:00.000", 31, today)).toBe(true);
    expect(backupDueOf("2026-06-01T09:00:00.000", 30, today)).toBe(false);
    expect(backupDueOf("2026-06-01T09:00:00.000", 0, today)).toBe(false);
  });
});
