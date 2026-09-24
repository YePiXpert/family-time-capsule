import { createContext, useContext } from "react";

/**
 * 应用锁盖着时为真。锁是主窗口里的一层；RN 的 Modal 自成一个原生窗口、画在它上面，
 * 所以带 Modal 的面板（AI、装订预览、选照片）要跟着收起，解锁后原样回来。
 */
export const LockedContext = createContext(false);
export const useLocked = () => useContext(LockedContext);
