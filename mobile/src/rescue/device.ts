import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import { buildRescuePackage, importRescuePackage } from "./rescue-package";
import {
  captureRecordExists,
  insertRestoredMediaCapture,
  insertRestoredTextCapture,
  listPendingRescueItems,
} from "../storage/database";

/**
 * 救援包与设备文件系统/系统分享的胶水（M4）。
 * 导出文件写入缓存目录后交给系统分享（用户保存到 App 私有目录之外）；
 * 不含任何凭据；导出校验成功才报告完成。
 */

function rescueCacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, "rescue");
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

/** 未入档的本机记录清单（元数据 + 载荷摘要）。 */
function listRescueItems() {
  return listPendingRescueItems();
}

/** 导出本机救援包，返回分享后的提示信息。 */
export async function exportRescuePackage(): Promise<string> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("此设备暂不支持系统分享，无法导出救援包。");
  }
  const items = await listRescueItems();
  if (items.length === 0) throw new Error("本机没有未入档的记录，无需救援包。");
  const bytes = await buildRescuePackage(items, {
    exists: (uri) => {
      try {
        return new File(uri).exists;
      } catch {
        return false;
      }
    },
    readBytes: async (uri) => new File(uri).bytes() as unknown as Uint8Array,
  });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const target = new File(rescueCacheDirectory(), `family-time-capsule-rescue-${stamp}.zip`);
  target.write(bytes as unknown as Uint8Array);
  // 写入后立即读回校验大小，失败不报成功。
  if (!target.exists || target.size !== bytes.byteLength) {
    throw new Error("救援包写入校验失败，未生成文件。");
  }
  await Sharing.shareAsync(target.uri, {
    mimeType: "application/zip",
    dialogTitle: "保存本机救援包",
  });
  return `已导出 ${items.length} 条本机记录。请保存到 App 之外的位置；它不是完整家庭备份。`;
}

/** 从用户选择的救援包文件恢复；返回统计。 */
export async function restoreRescuePackage(uri: string): Promise<{
  imported: number;
  skipped: number;
  missingFiles: number;
}> {
  const source = new File(uri);
  if (!source.exists) throw new Error("选择的救援包文件不存在。");
  const bytes = source.bytes() as unknown as Uint8Array;
  const capturesDirectory = new Directory(Paths.document, "captures");
  capturesDirectory.create({ idempotent: true, intermediates: true });
  return importRescuePackage(bytes, {
    captureExists: (captureId) => captureRecordExists(captureId),
    restoreText: async (input) => {
      await insertRestoredTextCapture({
        captureId: input.captureId,
        title: input.title,
        occurredAt: new Date().toISOString(),
        text: input.text,
      });
    },
    restoreMedia: async (input) => {
      const extension = input.fileName.match(/\.([a-z0-9]{1,8})$/iu)?.[1]?.toLowerCase() ?? "bin";
      const target = new File(capturesDirectory, `${input.captureId}.${extension}`);
      target.write(input.bytes as unknown as Uint8Array);
      if (!target.exists) throw new Error("恢复文件写入失败。");
      await insertRestoredMediaCapture({
        captureId: input.captureId,
        title: input.title,
        occurredAt: new Date().toISOString(),
        fileName: input.fileName,
        mimeType: input.mimeType,
        mediaType: input.mediaType,
        localUri: target.uri,
      });
    },
  });
}
