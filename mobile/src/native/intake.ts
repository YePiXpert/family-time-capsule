import { recoverCopiedIntakeCaptures } from "./intake-recovery";
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

export async function drainNativeShareIntake(scope: string): Promise<{
  manifests: number;
  queued: number;
  failed: number;
  retainedReadonly: number;
  recovered: number;
  recoveryPending: number;
}> {
  const prior = await recoverCopiedIntakeCaptures(`${Paths.document.uri.replace(/\/$/u, "")}/captures`, uri => new File(uri).exists);
  const recovered = await recoverPickerIntake(false);
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
      queue: false,
      scope,
    });
    accepted += 1;
    queued += result.queued;
    failed += result.failed;
    // The SQLite receipt now owns every preserved reference, including text.
    // Acknowledging the native manifest does not authorize an upload.
    await acknowledgeNativeShare(manifest.manifestId);
  }
  return {
    recovered: prior.recovered,
    recoveryPending: prior.unavailable,
    manifests: accepted,
    queued,
    failed,
    retainedReadonly: accepted,
  };
}
