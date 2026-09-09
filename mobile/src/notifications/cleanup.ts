import * as Notifications from "expo-notifications";

/** Remove reminders already scheduled by earlier installs; never request permission. */
export async function clearRetiredReminders(): Promise<void> {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(pending.filter(item => item.content.data?.kind === "weekly_review").map(item => Notifications.cancelScheduledNotificationAsync(item.identifier)));
  } catch {
    // An unavailable notification service must not prevent local recording.
  }
}
