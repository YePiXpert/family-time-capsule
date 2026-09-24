import * as SecureStore from "expo-secure-store";
import { AI_CONSENT_KEY, LEGACY_AI_CONSENT_KEY } from "../local/brand";
import { readCarriedOver } from "../family/session";
/**
 * 这台手机的 AI 同意标记，在系统钥匙串里。加入家庭不等于同意把内容交给 AI：这一项单独问。
 * 设备令牌不在这里，在 src/family/session.ts（家庭与设备）。
 */
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export const hasConsent = async () =>
  (await readCarriedOver(AI_CONSENT_KEY, LEGACY_AI_CONSENT_KEY)) === "v2";
export const giveConsent = () =>
  SecureStore.setItemAsync(AI_CONSENT_KEY, "v2", options);
