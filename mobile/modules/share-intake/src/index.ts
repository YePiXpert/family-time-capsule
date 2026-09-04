import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

export type NativeShareItem = {
  externalId: string;
  captureId: string;
  kind: "file" | "text" | "error";
  localUri?: string;
  fileName?: string;
  mimeType?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  text?: string;
  error?: string;
};

export type NativeShareManifest = {
  manifestId: string;
  source: "share";
  createdAt: string;
  complete: boolean;
  items: NativeShareItem[];
};

type NativeModule = {
  consumePendingAsync(): Promise<string>;
  acknowledgeAsync(manifestId: string): Promise<void>;
  addListener(event: "onPendingShares", listener: () => void): { remove(): void };
};

const nativeModule = requireOptionalNativeModule<NativeModule>("FamilyShareIntake");

export function subscribeToPendingNativeShares(listener: () => void): () => void {
  if (!nativeModule || Platform.OS !== "android") return () => {};
  const subscription = nativeModule.addListener("onPendingShares", listener);
  return () => subscription.remove();
}

export async function consumePendingNativeShares(): Promise<NativeShareManifest[]> {
  if (!nativeModule) return [];
  const raw = await nativeModule.consumePendingAsync();
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed as NativeShareManifest[] : [];
}

export async function acknowledgeNativeShare(manifestId: string): Promise<void> {
  if (nativeModule) await nativeModule.acknowledgeAsync(manifestId);
}
