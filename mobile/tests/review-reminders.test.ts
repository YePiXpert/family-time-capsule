import { describe, expect, it, vi } from "vitest";
import type { MobileReview } from "../src/types";
import {
  planReviewReminder,
  reconcileReviewReminder,
  REVIEW_REMINDER_BODY,
  REVIEW_REMINDER_ENABLED_KEY,
  setReviewReminderEnabled,
  type ReminderNotifications,
  type ReminderStore,
} from "../src/notifications/review-reminders-core";

function review(overrides: Partial<MobileReview> = {}): MobileReview {
  return {
    id: "review-1", key: "2026-08-31",
    periodStart: "2026-08-30T16:00:00.000Z", periodEnd: "2026-09-06T16:00:00.000Z",
    status: "open", storyId: null, startedAt: null, completedAt: null, canWrite: true,
    preferences: {
      timezone: "Asia/Shanghai", weekStartsOn: 1, reminderWeekday: 0,
      reminderLocalTime: "19:30", remindPendingInbox: true,
      remindPendingRequests: true, remindUpcomingCapsules: true,
    },
    counts: { inbox: 2, needsReview: 0, duplicateSuggestions: 0, clusterSuggestions: 0, guestSubmissions: 0, failedImports: 0, pendingRequests: 0, upcomingCapsules: 0 },
    reminderAt: "2026-09-06T11:30:00.000Z", events: [], ...overrides,
  };
}

function harness(permission: "granted" | "denied" | "undetermined" = "granted") {
  const data = new Map<string, string>();
  const store: ReminderStore = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => { data.set(key, value); },
    remove: async (key) => { data.delete(key); },
  };
  const notifications: ReminderNotifications = {
    permission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
    schedule: vi.fn(async () => "notification-1"),
    cancel: vi.fn(async () => undefined),
  };
  return { data, store, notifications };
}

describe("private weekly review reminders", () => {
  it("uses only the fixed private lock-screen copy", () => {
    const plan = planReviewReminder(review(), new Date("2026-09-05T00:00:00Z"));
    expect(plan).toMatchObject({ title: "家庭时间胶囊", body: REVIEW_REMINDER_BODY });
    expect(JSON.stringify(plan)).not.toContain("小满");
  });

  it("does not block review when permission is denied", async () => {
    const { data, store, notifications } = harness("denied");
    await expect(setReviewReminderEnabled(true, review(), store, notifications)).resolves.toBe("denied");
    expect(data.get(REVIEW_REMINDER_ENABLED_KEY)).toBe("0");
    expect(notifications.schedule).not.toHaveBeenCalled();
  });

  it("cancels and reschedules when family timezone changes", async () => {
    const { data, store, notifications } = harness();
    data.set(REVIEW_REMINDER_ENABLED_KEY, "1");
    await expect(reconcileReviewReminder(review(), store, notifications, new Date("2026-09-05T00:00:00Z"))).resolves.toBe("scheduled");
    const changed = review({
      preferences: { ...review().preferences, timezone: "America/New_York" },
      reminderAt: "2026-09-06T23:30:00.000Z",
      periodEnd: "2026-09-07T04:00:00.000Z",
    });
    await expect(reconcileReviewReminder(changed, store, notifications, new Date("2026-09-05T00:00:00Z"))).resolves.toBe("scheduled");
    expect(notifications.cancel).toHaveBeenCalledWith("notification-1");
    expect(notifications.schedule).toHaveBeenCalledTimes(2);
  });

  it("cancels the period reminder after completion", async () => {
    const { data, store, notifications } = harness();
    data.set(REVIEW_REMINDER_ENABLED_KEY, "1");
    await reconcileReviewReminder(review(), store, notifications, new Date("2026-09-05T00:00:00Z"));
    await expect(reconcileReviewReminder(review({ status: "completed" }), store, notifications, new Date("2026-09-05T00:00:00Z"))).resolves.toBe("cancelled");
    expect(notifications.cancel).toHaveBeenCalledWith("notification-1");
  });
});
