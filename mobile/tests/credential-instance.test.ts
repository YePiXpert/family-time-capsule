import { beforeEach, expect, it, vi } from "vitest";
const secure = vi.hoisted(() => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock("expo-secure-store", () => ({ ...secure, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "device-only" }));
const { loadCredentials, saveCredentials } = await import("../src/auth/credentials");
const credentials = { serverUrl: "https://family.example", token: "test-session", instanceId: "instance-A" };
beforeEach(() => vi.resetAllMocks());

it("persists the verified instance alongside the session with device-only keychain protection", async () => {
  await saveCredentials(credentials);
  expect(secure.setItemAsync).toHaveBeenCalledWith("family-time-capsule.session.v1", JSON.stringify(credentials), { keychainAccessible: "device-only" });
  secure.getItemAsync.mockResolvedValue(JSON.stringify(credentials));
  expect(await loadCredentials()).toEqual(credentials);
});

it("loads old sessions without inventing an instance identity", async () => {
  const legacy = { serverUrl: credentials.serverUrl, token: credentials.token };
  secure.getItemAsync.mockResolvedValue(JSON.stringify(legacy));
  expect(await loadCredentials()).toEqual(legacy);
});

it.each([null, 1, "", "a".repeat(129)])("rejects malformed instance identity %j instead of silently trusting it as a legacy session", async (instanceId) => {
  secure.getItemAsync.mockResolvedValue(JSON.stringify({ ...credentials, instanceId }));
  expect(await loadCredentials()).toBeNull();
});
