import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { deleteMeta, getCachedMobileReview, getMeta, setMeta } from "../storage/database";
import type { MobileReview } from "../types";
import {
  reconcileReviewReminder,
  setReviewReminderEnabled,
  type ReminderNotifications,
  type ReminderStore,
} from "./review-reminders-core";

const CHANNEL_ID = "weekly-review-private";

const store: ReminderStore = {
  get: getMeta,
  set: setMeta,
  remove: deleteMeta,
};

async function prepareChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "每周回顾",
    description: "只显示不含家庭正文的本地整理提醒",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
    showBadge: false,
    sound: null,
    enableVibrate: false,
  });
}

const notifications: ReminderNotifications = {
  async permission() {
    const result = await Notifications.getPermissionsAsync();
    return result.status;
  },
  async requestPermission() {
    const result = await Notifications.requestPermissionsAsync();
    return result.status;
  },
  async schedule(input) {
    await prepareChannel();
    return Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        data: { kind: "weekly_review", period: input.period },
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: input.date,
        ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
      },
    });
  },
  cancel: Notifications.cancelScheduledNotificationAsync,
};

export function configureNotificationPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      priority: Notifications.AndroidNotificationPriority.DEFAULT,
    }),
  });
}

export async function weeklyReviewReminderEnabled(): Promise<boolean> {
  return (await store.get("weekly_review_reminders_enabled")) === "1";
}

export async function updateWeeklyReviewReminder(enabled: boolean, review: MobileReview | null) {
  return setReviewReminderEnabled(enabled, review, store, notifications);
}

export async function reconcileWeeklyReviewReminder(review?: MobileReview | null) {
  return reconcileReviewReminder(review === undefined ? await getCachedMobileReview() : review, store, notifications);
}
