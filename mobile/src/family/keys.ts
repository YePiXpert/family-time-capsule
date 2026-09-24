import * as SecureStore from "expo-secure-store";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { DEVICE_KEY_ITEM } from "../local/brand";
import { x25519KeyPair } from "./hpke";
/**
 * 本机设备密钥（X25519）：管理者把内容钥匙封给它的公钥，只有这台手机能解开。
 * 私钥只在系统钥匙串，仅本机、解锁后可读，不进任何备份（换手机就是一台新设备，要重新批准）；
 * 存 32 字节私钥的 hex，公钥每次读出时现算。
 */
export type DeviceKey = { secretKey: Uint8Array; publicKey: Uint8Array };
const SECRET_BYTES = 32;
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
function parse(hex: string): DeviceKey | null {
  try {
    if (!/^[0-9a-f]{64}$/.test(hex)) return null;
    const secretKey = hexToBytes(hex);
    if (secretKey.length !== SECRET_BYTES || secretKey.every((b) => b === 0))
      return null;
    return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
  } catch {
    return null;
  }
}
/** 读出本机设备密钥；没有或存的东西坏了都当没有。 */
export async function loadDeviceKey(): Promise<DeviceKey | null> {
  const hex = await SecureStore.getItemAsync(DEVICE_KEY_ITEM);
  return hex === null ? null : parse(hex);
}
let pending: Promise<DeviceKey> | null = null;
async function createDeviceKey(): Promise<DeviceKey> {
  const existing = await loadDeviceKey();
  if (existing) return existing;
  const pair = x25519KeyPair();
  // 写失败直接抛出；写完再读回核对，绝不交出一把没存住的私钥（公钥登记出去就收不回了）。
  await SecureStore.setItemAsync(
    DEVICE_KEY_ITEM,
    bytesToHex(pair.secretKey),
    options,
  );
  const stored = await loadDeviceKey();
  if (!stored || bytesToHex(stored.secretKey) !== bytesToHex(pair.secretKey))
    throw new Error("设备钥匙没存住，请再试一次。");
  return stored;
}
/** 取本机设备密钥，没有就生成并存进钥匙串；同时来的几次调用共用同一次生成。 */
export function ensureDeviceKey(): Promise<DeviceKey> {
  pending ??= createDeviceKey().finally(() => {
    pending = null;
  });
  return pending;
}
/** 退出家庭或设备被停用后删掉；下次加入会生成一把新的。 */
export const forgetDeviceKey = () =>
  SecureStore.deleteItemAsync(DEVICE_KEY_ITEM);
