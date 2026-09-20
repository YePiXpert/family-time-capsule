import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { DOCS_DIR, REMOTE_KEY_ITEM } from "../local/brand";
import { keyFromHex, keyToHex } from "./crypto";
/**
 * 远端备份的本机状态：开没开、钥匙指纹、上次备份的时间与规模。
 * 不进 Library（备份里不该带着「我在哪台服务上」），单独一个 JSON；主密钥本体只在系统钥匙串。
 */
export type RemoteState = {
  version: 1;
  enabled: boolean;
  keyId: string;
  lastBackupAt?: string;
  lastBackupBytes?: number;
  lastBackupObjects?: number;
  lastError?: string;
};
export const syncDirectory = new Directory(Paths.document, DOCS_DIR, "sync");
const stateFile = () => new File(syncDirectory, "state.json");
export async function readRemoteState(): Promise<RemoteState | null> {
  const file = stateFile();
  if (!file.exists) return null;
  try {
    const parsed = JSON.parse(await file.text()) as RemoteState;
    if (
      parsed?.version !== 1 ||
      typeof parsed.enabled !== "boolean" ||
      !/^[a-f0-9]{16}$/.test(String(parsed.keyId))
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}
/** 先写 .part 再换名：断电也不会留下半个 JSON。 */
export function writeRemoteState(state: RemoteState): void {
  syncDirectory.create({ intermediates: true, idempotent: true });
  const part = new File(syncDirectory, "state.json.part");
  if (part.exists) part.delete();
  part.create();
  part.write(JSON.stringify(state));
  const target = stateFile();
  if (target.exists) target.delete();
  part.move(target);
}
export function clearRemoteState(): void {
  const file = stateFile();
  if (file.exists) file.delete();
}
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export async function loadKey(): Promise<Uint8Array | null> {
  const hex = await SecureStore.getItemAsync(REMOTE_KEY_ITEM);
  if (hex === null) return null;
  try {
    return keyFromHex(hex);
  } catch {
    return null;
  }
}
export const storeKey = (key: Uint8Array) =>
  SecureStore.setItemAsync(REMOTE_KEY_ITEM, keyToHex(key), options);
export const forgetKey = () => SecureStore.deleteItemAsync(REMOTE_KEY_ITEM);
