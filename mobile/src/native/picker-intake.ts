import { Directory, File, Paths } from "expo-file-system";
import { ingestLocalImportSession } from "../storage/database";
import { recoverPickerReceipt, type PickerReceipt } from "./picker-receipt";

const directory = new Directory(Paths.document, "picker-intake");
const active = new Set<string>();

/** Immutable, small receipt is closed before any original bytes are copied. */
export function beginPickerReceipt(receipt: PickerReceipt): void {
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `${receipt.captureId}.json`);
  file.create();
  file.write(JSON.stringify(receipt));
  active.add(receipt.captureId);
}

export function finishPickerReceipt(captureId: string, committed: boolean): void {
  active.delete(captureId);
  if (!committed) return;
  const file = new File(directory, `${captureId}.json`);
  if (file.exists) file.delete();
}

export async function recoverPickerIntake(queue: boolean) {
  const totals = { manifests: 0, queued: 0, failed: 0, retainedReadonly: 0 };
  if (!directory.exists) return totals;
  for (const file of directory.list()) {
    if (!(file instanceof File) || !file.name.endsWith(".json") || file.size > 16384) continue;
    const captureId = file.name.slice(0, -5);
    if (active.has(captureId)) continue;
    let receipt;
    try {
      receipt = recoverPickerReceipt(JSON.parse(file.textSync()), new Directory(Paths.document, "captures").uri,
        (uri) => new File(uri).exists);
    } catch { continue; }
    if (!receipt || receipt.items[0]?.captureId !== captureId) continue;
    const result = await ingestLocalImportSession({ ...receipt, source: "files", queue });
    totals.manifests++;
    totals.queued += result.queued;
    totals.failed += result.failed;
    if (queue) file.delete();
    else totals.retainedReadonly++;
  }
  return totals;
}
