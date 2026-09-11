import * as ExpoHaptics from "expo-haptics";

let enabled = true;

/** 设备级开关（设置页「触觉反馈」持久化后同步到这里）。 */
export function setHapticsEnabled(value: boolean) {
  enabled = value;
}

export function areHapticsEnabled() {
  return enabled;
}

function run(trigger: () => Promise<void>) {
  if (!enabled) return;
  trigger().catch(() => {});
}

/** 统一触觉入口：所有手势与确认交互都走这里，方便全局关闭。 */
export const haptics = {
  success: () => run(() => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success)),
  warning: () => run(() => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning)),
  selection: () => run(() => ExpoHaptics.selectionAsync()),
  impact: (style: ExpoHaptics.ImpactFeedbackStyle = ExpoHaptics.ImpactFeedbackStyle.Light) =>
    run(() => ExpoHaptics.impactAsync(style)),
};
