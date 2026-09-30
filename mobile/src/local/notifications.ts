import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { LocalStore } from "./store";
import { importantDays } from "./reminders";
const PREFIX = "anan-important-";
let queue: Promise<unknown> = Promise.resolve();
async function schedule(store: LocalStore) {
  const enabled = store.get().settings.birthdayNotifications;
  const old = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of old)
    if (n.identifier.startsWith(PREFIX))
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
  if (!enabled || !(await Notifications.getPermissionsAsync()).granted) return;
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("important-days", {
      name: "生日与拆信",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  for (const item of importantDays(store.get()))
    await Notifications.scheduleNotificationAsync({
      identifier: PREFIX + item.id,
      content: { title: item.title, body: item.body, sound: "default" },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: item.date,
        channelId: "important-days",
      },
    });
}
export async function setBirthdayNotifications(
  store: LocalStore,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    if (Platform.OS === "android")
      await Notifications.setNotificationChannelAsync("important-days", {
        name: "生日与拆信",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted)
      throw new Error("通知未获允许。可到系统设置开启，应用内的提示仍然保留。");
  }
  await store.change((s) => {
    s.settings.birthdayNotifications = enabled;
  });
  const job = queue.catch(() => undefined).then(() => schedule(store));
  queue = job;
  await job;
}
export function useImportantDayNotifications(store: LocalStore): void {
  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const request = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed)
          queue = queue
            .catch(() => undefined)
            .then(() => (disposed ? undefined : schedule(store)))
            .catch(() => undefined);
      }, 1000);
    };
    const key = () =>
      JSON.stringify([
        store.get().profile.birthday,
        store.get().settings.birthdayNotifications,
        importantDays(store.get()).map((r) => [r.id, r.date.toISOString()]),
      ]);
    let prior = key();
    const unsubscribe = store.subscribe(() => {
      const next = key();
      if (next !== prior) {
        prior = next;
        request();
      }
    });
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") request();
    });
    request();
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      listener.remove();
    };
  }, [store]);
}
