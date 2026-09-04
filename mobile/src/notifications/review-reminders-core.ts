import type { MobileReview } from "../types";

export const REVIEW_REMINDER_BODY = "这周有几段家庭记忆等待整理";
export const REVIEW_REMINDER_ENABLED_KEY = "weekly_review_reminders_enabled";
export const REVIEW_REMINDER_ID_KEY = "weekly_review_notification_id";
export const REVIEW_REMINDER_FINGERPRINT_KEY = "weekly_review_notification_fingerprint";

export type ReminderStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export type ReminderNotifications = {
  permission(): Promise<"granted" | "denied" | "undetermined">;
  requestPermission(): Promise<"granted" | "denied" | "undetermined">;
  schedule(input: { title: string; body: string; date: Date; period: string }): Promise<string>;
  cancel(id: string): Promise<void>;
};

export type ReminderPlan = {
  fingerprint: string;
  date: Date;
  title: string;
  body: typeof REVIEW_REMINDER_BODY;
  period: string;
};

export function planReviewReminder(review: MobileReview, now = new Date()): ReminderPlan | null {
  const shouldRemind =
    (review.preferences.remindPendingInbox && review.counts.inbox > 0) ||
    (review.preferences.remindPendingRequests && review.counts.pendingRequests > 0) ||
    (review.preferences.remindUpcomingCapsules && review.counts.upcomingCapsules > 0);
  if (review.status === "completed" || !shouldRemind || !review.reminderAt) return null;
  const date = new Date(review.reminderAt);
  if (Number.isNaN(date.getTime()) || date <= now || date >= new Date(review.periodEnd)) return null;
  return {
    fingerprint: [review.key, review.preferences.timezone, date.toISOString(), REVIEW_REMINDER_BODY].join("|"),
    date,
    title: "家庭时间胶囊",
    body: REVIEW_REMINDER_BODY,
    period: review.key,
  };
}

async function cancelStored(store: ReminderStore, notifications: ReminderNotifications): Promise<void> {
  const identifier = await store.get(REVIEW_REMINDER_ID_KEY);
  if (identifier) {
    try { await notifications.cancel(identifier); }
    catch { /* An already-delivered or OS-pruned reminder is safe to forget. */ }
  }
  await Promise.all([
    store.remove(REVIEW_REMINDER_ID_KEY),
    store.remove(REVIEW_REMINDER_FINGERPRINT_KEY),
  ]);
}

export async function reconcileReviewReminder(
  review: MobileReview | null,
  store: ReminderStore,
  notifications: ReminderNotifications,
  now = new Date(),
): Promise<"disabled" | "denied" | "unchanged" | "scheduled" | "cancelled"> {
  if ((await store.get(REVIEW_REMINDER_ENABLED_KEY)) !== "1") {
    await cancelStored(store, notifications);
    return "disabled";
  }
  if ((await notifications.permission()) !== "granted") {
    await cancelStored(store, notifications);
    return "denied";
  }
  const plan = review ? planReviewReminder(review, now) : null;
  if (!plan) {
    await cancelStored(store, notifications);
    return "cancelled";
  }
  const [fingerprint, identifier] = await Promise.all([
    store.get(REVIEW_REMINDER_FINGERPRINT_KEY),
    store.get(REVIEW_REMINDER_ID_KEY),
  ]);
  if (fingerprint === plan.fingerprint && identifier) return "unchanged";
  await cancelStored(store, notifications);
  const nextId = await notifications.schedule(plan);
  await store.set(REVIEW_REMINDER_ID_KEY, nextId);
  await store.set(REVIEW_REMINDER_FINGERPRINT_KEY, plan.fingerprint);
  return "scheduled";
}

export async function setReviewReminderEnabled(
  enabled: boolean,
  review: MobileReview | null,
  store: ReminderStore,
  notifications: ReminderNotifications,
  now = new Date(),
): Promise<"disabled" | "denied" | "unchanged" | "scheduled" | "cancelled"> {
  if (!enabled) {
    await store.set(REVIEW_REMINDER_ENABLED_KEY, "0");
    await cancelStored(store, notifications);
    return "disabled";
  }
  const status = await notifications.permission();
  const granted = status === "granted" || (await notifications.requestPermission()) === "granted";
  if (!granted) {
    await store.set(REVIEW_REMINDER_ENABLED_KEY, "0");
    await cancelStored(store, notifications);
    return "denied";
  }
  await store.set(REVIEW_REMINDER_ENABLED_KEY, "1");
  return reconcileReviewReminder(review, store, notifications, now);
}
