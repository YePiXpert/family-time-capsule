import { beforeEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  ensureDeviceKey,
  forgetDeviceKey,
  loadDeviceKey,
} from "../src/family/keys";
import { DEVICE_KEY_ITEM } from "../src/local/brand";

const secure = vi.hoisted(() => ({
  store: new Map<string, string>(),
  options: [] as unknown[],
  failWrite: false,
  /** 写入「成功」却什么都没存（模拟钥匙串悄悄丢写）。 */
  dropWrite: false,
}));
vi.mock("expo-crypto", () => ({
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
}));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked",
  getItemAsync: async (key: string) => secure.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string, options?: unknown) => {
    if (secure.failWrite) throw new Error("keychain unavailable");
    secure.options.push(options);
    if (!secure.dropWrite) secure.store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secure.store.delete(key);
  },
}));

beforeEach(() => {
  secure.store.clear();
  secure.options.length = 0;
  secure.failWrite = false;
  secure.dropWrite = false;
});

it("creates, stores (this device only, when unlocked) and reloads the device key", async () => {
  expect(DEVICE_KEY_ITEM).toBe("anan-device-key-v1");
  expect(await loadDeviceKey()).toBeNull();
  const key = await ensureDeviceKey();
  expect(key.secretKey).toHaveLength(32);
  expect(key.publicKey).toEqual(x25519.getPublicKey(key.secretKey));
  expect(secure.store.get(DEVICE_KEY_ITEM)).toBe(bytesToHex(key.secretKey));
  expect(secure.options).toEqual([{ keychainAccessible: "unlocked" }]);
  expect(await loadDeviceKey()).toEqual(key);
  expect(await ensureDeviceKey()).toEqual(key);
  expect(secure.options).toHaveLength(1);
});

it("concurrent callers share one generated key", async () => {
  const [a, b, c] = await Promise.all([
    ensureDeviceKey(),
    ensureDeviceKey(),
    ensureDeviceKey(),
  ]);
  expect(b).toEqual(a);
  expect(c).toEqual(a);
  expect(secure.options).toHaveLength(1);
});

it("treats a damaged stored value as missing", async () => {
  for (const bad of [
    "",
    "zz".repeat(32),
    "ab".repeat(16),
    "AB".repeat(32),
    "00".repeat(32),
  ]) {
    secure.store.set(DEVICE_KEY_ITEM, bad);
    expect(await loadDeviceKey()).toBeNull();
  }
  const fresh = await ensureDeviceKey();
  expect(secure.store.get(DEVICE_KEY_ITEM)).toBe(bytesToHex(fresh.secretKey));
});

it("never hands out a key that was not saved", async () => {
  secure.failWrite = true;
  await expect(ensureDeviceKey()).rejects.toThrow();
  expect(secure.store.has(DEVICE_KEY_ITEM)).toBe(false);
  secure.failWrite = false;
  secure.dropWrite = true;
  await expect(ensureDeviceKey()).rejects.toThrow("设备钥匙没存住");
  secure.dropWrite = false;
  const key = await ensureDeviceKey();
  expect(await loadDeviceKey()).toEqual(key);
});

it("forget removes the key and the next ensure makes a new one", async () => {
  const first = await ensureDeviceKey();
  await forgetDeviceKey();
  expect(await loadDeviceKey()).toBeNull();
  const second = await ensureDeviceKey();
  expect(bytesToHex(second.secretKey)).not.toBe(bytesToHex(first.secretKey));
});
