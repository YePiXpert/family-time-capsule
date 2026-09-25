import { createContext, useContext } from "react";

/**
 * 应用锁盖着时为真。锁是主窗口里的一层；RN 的 Modal 自成一个原生窗口、画在它上面，
 * 所以带 Modal 的面板（AI、装订预览、选照片）要跟着收起，解锁后原样回来。
 */
export const LockedContext = createContext(false);
export const useLocked = () => useContext(LockedContext);
/**
 * iOS 开着应用锁、应用不在前台（多任务界面、控制中心、进后台）时为真：主窗口盖一层纸面。
 * 这时面板不收（拉一下控制中心不该把面板关掉），由 Modal 里的 PrivacyCover 自己再盖一层。
 */
export const CoveredContext = createContext(false);
export const useCovered = () => useContext(CoveredContext);

/**
 * 解锁失败时给哪句提示。设备后来关掉了锁屏密码（安卓 not_enrolled、iOS passcode_not_set）
 * 或没有可用的验证方式时，系统不抛错而是返回失败；这时「再试一次」永远试不过，要告诉人
 * 先去系统设置重新打开锁屏密码。锁本身不放开。
 */
export function unlockFailureMessage(error?: string): string {
  return ["not_enrolled", "passcode_not_set", "not_available"].includes(
    error ?? "",
  )
    ? "这台手机的锁屏密码已关闭。到系统设置重新打开锁屏密码后，再点解锁。"
    : "没有解锁成功，再试一次。";
}
/**
 * 验证一次：通过返回 null，否则返回要显示的提示。系统验证抛错（安卓拿不到界面、内部错误）
 * 和验证不过一样，锁照旧：主人 2026-09-25 定了锁不自己放开。
 */
export async function attemptUnlock(
  authenticate: () => Promise<{ success: boolean; error?: string }>,
): Promise<string | null> {
  try {
    const result = await authenticate();
    return result.success ? null : unlockFailureMessage(result.error);
  } catch {
    return unlockFailureMessage();
  }
}
