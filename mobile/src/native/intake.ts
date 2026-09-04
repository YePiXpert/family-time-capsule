import { File, Paths } from "expo-file-system";
import {
  acknowledgeNativeShare,
  consumePendingNativeShares,
} from "../../modules/share-intake/src";
import { ingestLocalImportSession } from "../storage/database";
import { normalizeNativeShareManifest } from "./intake-core";
import { recoverPickerIntake } from "./picker-intake";

function isPrivateCaptureUri(uri: string): boolean {
  const captureRoot = `${Paths.document.uri.replace(/\/$/u, "")}/captures/`;
  return uri.startsWith(captureRoot) && !uri.slice(captureRoot.length).includes("/");
}

export async function drainNativeShareIntake(queue: boolean): Promise<{
  manifests: number;
  queued: number;
  failed: number;
  retainedReadonly: number;
}> {
  const recovered = await recoverPickerIntake(queue);
  const manifests = await consumePendingNativeShares();
  let accepted = recovered.manifests;
  let queued = recovered.queued;
  let failed = recovered.failed;
  for (const manifest of manifests) {
    const normalized = normalizeNativeShareManifest(manifest, (uri) => {
      if (!isPrivateCaptureUri(uri)) return false;
      try {
        return new File(uri).exists;
      } catch {
        return false;
      }
    });
    if (!normalized) continue;
    const result = await ingestLocalImportSession({
      ...normalized,
      source: "share",
      queue,
    });
    accepted += 1;
    queued += result.queued;
    failed += result.failed;
    // In read-only mode the durable manifest stays available. If the device is
    // disconnected later, the already-copied originals can then be queued.
    if (queue) await acknowledgeNativeShare(manifest.manifestId);
  }
  return {
    manifests: accepted,
    queued,
    failed,
    retainedReadonly: queue ? 0 : accepted,
  };
}
