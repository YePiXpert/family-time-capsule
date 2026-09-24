import * as SecureStore from "expo-secure-store";
import { AI_SESSION_KEY, LEGACY_AI_SESSION_KEY } from "../local/brand";
/**
 * 这台手机的家庭设备令牌，在系统钥匙串里（仅本机、解锁后可读，不进任何备份）。
 * AI、同步、家庭与设备三处共用这一枚：管理者扫码批准或凭恢复码找回时拿到，退出家庭时删掉。
 * 键名沿用 1.0.8 以前 AI 登录用的那个，升级不会掉线（历史原因，名字里还带 ai）。
 */
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
/** 改名前的键里可能还存着这台设备的令牌；读到就搬到新键上，搬不动就照旧值用。 */
export async function readCarriedOver(key: string, legacy: string) {
  const current = await SecureStore.getItemAsync(key);
  if (current !== null) return current;
  const carried = await SecureStore.getItemAsync(legacy);
  if (carried === null) return null;
  try {
    await SecureStore.setItemAsync(key, carried, options);
    await SecureStore.deleteItemAsync(legacy);
  } catch {
    // 钥匙串写不进去也不该挡住这次调用：这一轮先用旧键的值。
  }
  return carried;
}
export const getToken = () => readCarriedOver(AI_SESSION_KEY, LEGACY_AI_SESSION_KEY);
/** 存令牌后读回核对：钥匙串没存住就抛错，调用方不能当作已经加入。 */
export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(AI_SESSION_KEY, token, options);
  if ((await SecureStore.getItemAsync(AI_SESSION_KEY)) !== token)
    throw new Error("这台手机的钥匙串没存住，请再试一次。");
}
export async function forgetToken(): Promise<void> {
  await SecureStore.deleteItemAsync(AI_SESSION_KEY);
  await SecureStore.deleteItemAsync(LEGACY_AI_SESSION_KEY);
}
