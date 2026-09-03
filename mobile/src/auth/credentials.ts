import * as SecureStore from "expo-secure-store";
import type { Credentials } from "../types";

const CREDENTIALS_KEY = "family-time-capsule.session.v1";

export async function loadCredentials(): Promise<Credentials | null> {
  const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Credentials>;
    if (typeof value.serverUrl !== "string" || typeof value.token !== "string") {
      return null;
    }
    return { serverUrl: value.serverUrl, token: value.token };
  } catch {
    return null;
  }
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
}
