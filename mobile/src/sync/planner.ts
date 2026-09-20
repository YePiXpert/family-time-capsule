import type { BackupBlob } from "../local/backup-format";
import type { ObjectRef } from "./crypto";
/** 明文块 1 MiB、每对象至多 4 块：对象 ≈ 4 MiB，服务端硬上限 8 MiB，留足余量。纯函数，零依赖。 */
export const CHUNK_BYTES = 1024 * 1024;
export const CHUNKS_PER_OBJECT = 4;
export const OBJECT_BYTES = CHUNK_BYTES * CHUNKS_PER_OBJECT;
export type ObjectPlan = ObjectRef & {
  /** 该对象承载内容的 [from, from + bytes) 字节。 */
  from: number;
  bytes: number;
};
/** 一份内容切成几个对象；内容至少 1 字节。 */
export function objectsOf(sha256: string, bytes: number): ObjectPlan[] {
  if (!Number.isSafeInteger(bytes) || bytes < 1)
    throw new Error("内容长度不对。");
  const plans: ObjectPlan[] = [];
  for (let from = 0, part = 0; from < bytes; from += OBJECT_BYTES, part++)
    plans.push({
      sha256,
      part,
      from,
      bytes: Math.min(OBJECT_BYTES, bytes - from),
      final: from + OBJECT_BYTES >= bytes,
    });
  return plans;
}
/** 一个对象内的块长度序列：整 MiB 块加一个尾块。 */
export function chunkSizes(bytes: number): number[] {
  const sizes: number[] = [];
  for (let at = 0; at < bytes; at += CHUNK_BYTES)
    sizes.push(Math.min(CHUNK_BYTES, bytes - at));
  return sizes;
}
export type UploadItem = ObjectPlan & { id: string };
/** 全部素材的全部对象，顺序固定（素材清单序 × part 序），id 由钥匙派生。 */
export function planUpload(
  blobs: readonly BackupBlob[],
  idOf: (sha256: string, part: number) => string,
): UploadItem[] {
  return blobs.flatMap((blob) =>
    objectsOf(blob.sha256, blob.bytes).map((plan) => ({
      ...plan,
      id: idOf(plan.sha256, plan.part),
    })),
  );
}
export const pendingOf = (items: readonly UploadItem[], missing: Set<string>) =>
  items.filter((item) => missing.has(item.id));
export function bytesLabel(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(0.1, bytes / 1048576).toFixed(1)} MB`;
}
export const progressLabel = (done: number, total: number) =>
  `正在上传 ${done}/${total}`;
