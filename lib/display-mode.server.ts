import { cookies } from "next/headers";
import { DISPLAY_MODE_COOKIE, parseDisplayMode, type DisplayMode } from "./display-mode";

/** 服务端读取当前设备的显示偏好（root layout / RSC 页面使用）。 */
export async function getDisplayMode(): Promise<DisplayMode> {
  const store = await cookies();
  return parseDisplayMode(store.get(DISPLAY_MODE_COOKIE)?.value);
}
