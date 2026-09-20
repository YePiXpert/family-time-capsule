import { Directory, File, FileMode, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import {
  BACKUP_MAGIC_V2,
  VOLUME_LIMIT,
  decodeLibraryV2,
  encodeMetaHead,
  planVolumes,
  type BackupMetaV2,
  type Volume,
} from "./backup-format";
import {
  BackupStopped,
  backupFileName,
  blobOwners,
  readManifest,
  streamBlob,
  type RestoreProgress,
} from "./backup";
import type { LocalMedia, Stored } from "./model";
/** 导出用的临时目录：一次只放一卷，分享完就删；下次导出前也先清空。 */
export const exportDirectory = new Directory(Paths.cache, "export");
/** 写一卷之外还要给系统与分享面板留的余量。 */
export const EXPORT_MARGIN = 64 * 1024 * 1024;
export type ExportPlan = {
  meta: BackupMetaV2;
  entities: Uint8Array;
  /** sha256 → 一条代表素材，只为报错时能说出照片的名字。 */
  owners: Map<string, Stored<LocalMedia>>;
  volumes: Volume[];
  /** 与保留备份同名（不含扩展名）；分卷再加 -vol1of3。 */
  stem: string;
  setId: string;
};
/**
 * 从一份清单备份（.xmbm）规划导出：单卷装得下就是一份与 Build 68 逐字节同形的 .xmb；
 * 装不下按 2 GiB 贪心分卷。头部按带 set 的最长写法估算，保证每一卷都不超限。
 */
export function planExport(manifest: File, limit = VOLUME_LIMIT): ExportPlan {
  const { meta, entities } = readManifest(manifest);
  const owners = blobOwners(decodeLibraryV2(meta, entities));
  const named = manifest.name.match(/^(.+-\d{8}-\d{4}-)([a-f0-9]{8})\.xmbm$/);
  const setId = named?.[2] ?? randomUUID().replace(/-/g, "").slice(0, 8);
  const stem = named
    ? `${named[1]}${setId}`
    : backupFileName(new Date(), setId).replace(/\.xmb$/, "");
  const worstHead = encodeMetaHead({
    ...meta,
    set: {
      id: setId,
      index: 99999,
      count: 99999,
      from: meta.blobs.length,
      take: meta.blobs.length,
    },
  }).length;
  const volumes = planVolumes(meta.blobs, worstHead + entities.length, limit);
  return { meta, entities, owners, volumes, stem, setId };
}
export const volumeName = (plan: ExportPlan, index: number) =>
  plan.volumes.length === 1
    ? `${plan.stem}.xmb`
    : `${plan.stem}-vol${index + 1}of${plan.volumes.length}.xmb`;
/** 导出这一卷需要的临时空间够不够：卷的字节数加余量；查不到剩余空间就放行。 */
export function assertExportSpace(bytes: number): void {
  const free = Paths.availableDiskSpace;
  if (Number.isFinite(free) && free < bytes + EXPORT_MARGIN)
    throw new Error(
      `本机空间不足：写这一卷需要约 ${Math.ceil((bytes + EXPORT_MARGIN) / 1048576)} MB 的临时空间，请先清理一些空间再导出。`,
    );
}
export function purgeExports(): void {
  if (exportDirectory.exists) exportDirectory.delete();
}
/**
 * 写第 index 卷：v2 魔数 + meta（分卷时带 set）+ 实体 + 本卷承载的素材字节，
 * 素材从 blob 库逐块搬出并核对哈希。中途停止或出错就删掉半成品。
 */
export async function writeVolume(
  plan: ExportPlan,
  index: number,
  onProgress?: RestoreProgress,
  signal?: AbortSignal,
): Promise<File> {
  const volume = plan.volumes[index]!;
  const count = plan.volumes.length;
  const meta: BackupMetaV2 =
    count === 1
      ? plan.meta
      : {
          ...plan.meta,
          set: {
            id: plan.setId,
            index,
            count,
            from: volume.from,
            take: volume.take,
          },
        };
  const head = encodeMetaHead(meta, BACKUP_MAGIC_V2);
  const slice = plan.meta.blobs.slice(volume.from, volume.from + volume.take);
  assertExportSpace(
    head.length +
      plan.entities.length +
      slice.reduce((n, blob) => n + blob.bytes, 0),
  );
  exportDirectory.create({ intermediates: true, idempotent: true });
  const out = new File(exportDirectory, volumeName(plan, index));
  if (out.exists) out.delete();
  out.create();
  const h = out.open(FileMode.WriteOnly);
  try {
    h.writeBytes(head);
    if (plan.entities.length) h.writeBytes(plan.entities);
    let done = 0;
    for (const blob of slice) {
      if (signal?.aborted) throw new BackupStopped();
      await streamBlob(blob, h, plan.owners.get(blob.sha256)!.name);
      done++;
      onProgress?.(
        count === 1
          ? `正在写入备份 ${done}/${slice.length}`
          : `正在写第 ${index + 1} 卷／共 ${count} 卷 ${done}/${slice.length}`,
      );
    }
  } catch (e) {
    h.close();
    if (out.exists) out.delete();
    throw e;
  }
  h.close();
  return out;
}
