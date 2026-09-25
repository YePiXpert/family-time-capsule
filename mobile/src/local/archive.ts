/**
 * 开放归档的编排：规划版面 → 查剩余空间 → 流式写 ZIP 到缓存 → 交给系统分享面板。
 *
 * 与备份同一套态度：素材缺一份就整份不写；任何时刻内存里只有一个 256KiB 分块；
 * 中途停止就删掉半成品。归档文件留在缓存里给分享目标慢慢读，下一次导出前清掉。
 */
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  planArchive,
  type ArchiveOptions,
  type ArchivePlan,
} from "./archive-layout";
import { ARCHIVE_VIEWER_HTML } from "./archive-viewer";
import { mediaFile } from "./files";
import type { Library } from "./model";
import { ZipWriter } from "./zip";

export type ArchiveRequest = Pick<ArchiveOptions, "year" | "includeSealedLetters">;
export type ArchiveProgress = {
  done: number;
  total: number;
  bytes: number;
  totalBytes: number;
};
const CHUNK = 262144;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export class ArchiveStopped extends Error {
  constructor() {
    super("已停止，没有生成文件。");
    this.name = "ArchiveStopped";
  }
}

const archiveDirectory = () => new Directory(Paths.cache, "archive");

/** 上一次导出的归档留在缓存里给分享目标读；下一次导出前清掉。 */
export function purgeArchives(): void {
  const directory = archiveDirectory();
  if (!directory.exists) return;
  for (const entry of directory.list())
    if (entry instanceof File && entry.name.endsWith(".zip")) entry.delete();
}

/** 估算归档大小：素材原样，ZIP 结构与文字网页另加一点。 */
export function estimateArchiveBytes(plan: ArchivePlan): number {
  const text = plan.entries.reduce(
    (n, e) => n + (e.kind === "text" ? e.text.length * 3 : 0),
    0,
  );
  return Math.ceil(plan.mediaBytes * 1.02) + text + 1024 * 1024;
}

export function assertDiskSpace(
  needed: number,
  free: number = Paths.availableDiskSpace,
): void {
  if (Number.isFinite(free) && free < needed)
    throw new Error(
      `本机剩余空间不够（这份归档约 ${Math.max(1, Math.round(needed / 1048576))} MB），先清理或分年归档。`,
    );
}

/** 流式写入：文字条目直接写，素材分块读、边写边算 CRC；失败或停止都删掉半成品。 */
export async function writeArchive(
  state: Library,
  plan: ArchivePlan,
  target: File,
  onProgress?: (progress: ArchiveProgress) => void,
  signal?: AbortSignal,
): Promise<File> {
  for (const e of plan.entries) {
    if (e.kind !== "media") continue;
    const m = state.media[e.mediaId]!,
      source = mediaFile(m);
    if (!source.exists || source.size !== m.bytes)
      throw new Error(`素材缺失或损坏：${m.name}`);
  }
  if (target.exists) target.delete();
  target.create();
  const handle = target.open(FileMode.WriteOnly);
  const zip = new ZipWriter((bytes) => handle.writeBytes(bytes));
  let done = 0,
    bytes = 0;
  const report = () =>
    onProgress?.({
      done,
      total: plan.mediaCount,
      bytes,
      totalBytes: plan.mediaBytes,
    });
  try {
    report();
    for (const e of plan.entries) {
      if (signal?.aborted) throw new ArchiveStopped();
      if (e.kind === "text") {
        zip.addText(e.path, e.text);
        continue;
      }
      const m = state.media[e.mediaId]!;
      const input = mediaFile(m).open(FileMode.ReadOnly);
      let remaining = m.bytes;
      try {
        await zip.addStream(e.path, m.bytes, async () => {
          if (signal?.aborted) throw new ArchiveStopped();
          if (!remaining) return null;
          const chunk = input.readBytes(Math.min(CHUNK, remaining));
          if (!chunk.length) throw new Error(`素材读取失败：${m.name}`);
          remaining -= chunk.length;
          bytes += chunk.length;
          await tick();
          return chunk;
        });
      } finally {
        input.close();
      }
      done++;
      report();
    }
    zip.finish();
  } catch (e) {
    handle.close();
    if (target.exists) target.delete();
    throw e;
  }
  handle.close();
  return target;
}

export async function createArchive(
  state: Library,
  request: ArchiveRequest,
  onProgress?: (progress: ArchiveProgress) => void,
  signal?: AbortSignal,
): Promise<{ file: File; plan: ArchivePlan }> {
  const plan = planArchive(state, { ...request, viewerHtml: ARCHIVE_VIEWER_HTML });
  purgeArchives();
  assertDiskSpace(estimateArchiveBytes(plan));
  const directory = archiveDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `${plan.root}.zip`);
  await writeArchive(state, plan, file, onProgress, signal);
  return { file, plan };
}

export async function shareArchive(file: File): Promise<void> {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("此设备暂不支持导出，请稍后重试。");
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/zip",
    UTI: "public.zip-archive",
    dialogTitle: "保存可阅读副本",
  });
}
