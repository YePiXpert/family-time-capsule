import * as SecureStore from "expo-secure-store";
import {
  AI_CONSENT_KEY,
  AI_SESSION_KEY,
  LEGACY_AI_CONSENT_KEY,
  LEGACY_AI_SESSION_KEY,
} from "../local/brand";
/**
 * 这台设备的家人账号凭证与 AI 同意标记，都在系统钥匙串里。
 * AI 客户端与远端备份传输层共用这一份：登录一次，两边都认。
 */
const SESSION = AI_SESSION_KEY,
  CONSENT = AI_CONSENT_KEY;
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
/** 改名前的键里可能还存着这台设备的凭证；读到就搬到新键上，
 *  否则一次改名就把已经加入 AI 的设备静默踢了出去。搬不动就照旧值用。 */
async function readCarriedOver(key: string, legacy: string) {
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
export const getToken = () => readCarriedOver(SESSION, LEGACY_AI_SESSION_KEY);
export const saveToken = (token: string) =>
  SecureStore.setItemAsync(SESSION, token, options);
export const disconnect = async () => {
  await SecureStore.deleteItemAsync(SESSION);
  await SecureStore.deleteItemAsync(LEGACY_AI_SESSION_KEY);
};
export const hasConsent = async () =>
  (await readCarriedOver(CONSENT, LEGACY_AI_CONSENT_KEY)) === "v2";
export const giveConsent = () =>
  SecureStore.setItemAsync(CONSENT, "v2", options);
