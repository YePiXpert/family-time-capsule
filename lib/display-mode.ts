/**
 * 设备级显示体验偏好（NAV-11 长辈/简洁阅读模式）——共享常量。
 *
 * 这是一个纯 UI 偏好，不进入账号/家庭 schema：同一台设备可以一直使用
 * 大字显示，另一台设备保持标准显示。切换账号时偏好保留——它不属于
 * 任何账号的敏感界面状态；服务端授权逻辑完全不因此改变。
 * 本文件不依赖 server-only API，客户端组件也可以导入。
 */
export const DISPLAY_MODE_COOKIE = "ftc_display";

export type DisplayMode = "standard" | "simple";

export const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  standard: "标准显示",
  simple: "大字显示",
};

export function parseDisplayMode(value: string | undefined | null): DisplayMode {
  return value === "simple" ? "simple" : "standard";
}
