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
