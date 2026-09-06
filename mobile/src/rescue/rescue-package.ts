import JSZip from "jszip";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * 本机救援包（M4）：导出尚未同步的“用户自有本机记录”（文字全文、
 * 原件文件、元数据与 SHA-256 清单），或把救援包恢复回本机。
 *
 * 边界：
 * - 只包含本机记录；不含 session、密码、setup/invite token；
 * - 不是完整家庭备份，导出界面不得如此称呼；
 * - 恢复先整体校验（格式、路径、哈希、解压上限），全部通过才写入；
 * - 恢复的记录默认仅本机保存（pending），不会自动上传到当前家庭。
 */

export const RESCUE_FORMAT = "ftc-local-rescue";
export const RESCUE_VERSION = 1;
export const MANIFEST_PATH = "manifest.json";
const MAX_ENTRIES = 10000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2GB 解压上限，防炸弹

export type RescueItem = {
  captureId: string;
  kind: "text_capture" | "media_capture";
  title: string;
  occurredAt: string;
  localUri: string | null;
  mediaType: string | null;
  fileName: string | null;
  mimeType: string | null;
  text: string | null;
};

export type RescueManifestEntry = {
  captureId: string;
  kind: "text_capture" | "media_capture";
  title: string;
  occurredAt: string;
  mediaType: string | null;
  fileName: string | null;
  mimeType: string | null;
  text: string | null;
  file: string | null;
  sha256: string | null;
  bytes: number;
};

export type RescueManifest = {
  format: typeof RESCUE_FORMAT;
  version: 1;
  exportedAt: string;
  captures: RescueManifestEntry[];
};

export type RescueIO = {
  exists(uri: string): boolean;
  readBytes(uri: string): Promise<Uint8Array>;
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function entryFileName(item: RescueItem): string {
  const extension = item.fileName?.match(/\.([a-z0-9]{1,8})$/iu)?.[1]?.toLowerCase();
  return `files/${item.captureId}${extension ? `.${extension}` : ""}`;
}

function isSafeEntryPath(path: string): boolean {
  if (path === MANIFEST_PATH) return true;
  if (!path.startsWith("files/")) return false;
  const rest = path.slice("files/".length);
  return rest.length > 0 && /^[a-z0-9-]+\.[a-z0-9]{1,8}$/iu.test(rest);
}

/** 构建救援包字节流；文件缺失的条目如实记录为缺文件，不伪装成功。 */
export async function buildRescuePackage(
  items: RescueItem[],
  io: RescueIO,
): Promise<Uint8Array> {
  const zip = new JSZip();
  const entries: RescueManifestEntry[] = [];
  let totalBytes = 0;
  for (const item of items) {
    let file: string | null = null;
    let digest: string | null = null;
    let bytes = 0;
    if (item.kind === "media_capture" && item.localUri && io.exists(item.localUri)) {
      const content = await io.readBytes(item.localUri);
      totalBytes += content.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("本机记录总量超出救援包上限，请分批导出。");
      }
      file = entryFileName(item);
      digest = toHex(sha256(content));
      bytes = content.byteLength;
      zip.file(file, content);
    }
    entries.push({
      captureId: item.captureId,
      kind: item.kind,
      title: item.title,
      occurredAt: item.occurredAt,
      mediaType: item.mediaType,
      fileName: item.fileName,
      mimeType: item.mimeType,
      text: item.kind === "text_capture" ? item.text : null,
      file,
      sha256: digest,
      bytes,
    });
  }
  const manifest: RescueManifest = {
    format: RESCUE_FORMAT,
    version: RESCUE_VERSION,
    exportedAt: new Date().toISOString(),
    captures: entries,
  };
  zip.file(MANIFEST_PATH, JSON.stringify(manifest));
  return zip.generateAsync({ type: "uint8array" });
}

/** 解析并校验救援包：格式、路径、数量、解压上限、每文件 SHA-256。 */
export async function verifyRescuePackage(
  bytes: Uint8Array,
): Promise<{ manifest: RescueManifest; files: Map<string, Uint8Array> }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("这不是有效的救援包文件。");
  }
  const paths = Object.keys(zip.files);
  if (paths.length > MAX_ENTRIES) throw new Error("救援包条目过多，已拒绝。");
  let totalBytes = 0;
  const files = new Map<string, Uint8Array>();
  for (const path of paths) {
    if (zip.files[path]?.dir) continue;
    if (!isSafeEntryPath(path)) throw new Error(`救援包含有非法路径：${path}`);
    const content = await zip.files[path]!.async("uint8array");
    totalBytes += content.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("救援包解压总量超出上限，已拒绝。");
    files.set(path, content);
  }
  const manifestBytes = files.get(MANIFEST_PATH);
  if (!manifestBytes) throw new Error("救援包缺少清单文件。");
  let manifest: RescueManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as RescueManifest;
  } catch {
    throw new Error("救援包清单无法读取。");
  }
  if (
    manifest.format !== RESCUE_FORMAT ||
    manifest.version !== RESCUE_VERSION ||
    !Array.isArray(manifest.captures) ||
    manifest.captures.length > MAX_ENTRIES
  ) {
    throw new Error("救援包格式或版本不兼容。");
  }
  for (const entry of manifest.captures) {
    if (!entry.file || !entry.sha256) continue;
    const content = files.get(entry.file);
    if (!content) throw new Error(`救援包缺少文件：${entry.file}`);
    if (toHex(sha256(content)) !== entry.sha256) {
      throw new Error(`文件校验失败：${entry.fileName ?? entry.file}`);
    }
  }
  return { manifest, files };
}

export type RescueImportSink = {
  captureExists(captureId: string): Promise<boolean>;
  restoreText(input: { captureId: string; title: string; text: string }): Promise<void>;
  restoreMedia(input: {
    captureId: string;
    title: string;
    fileName: string;
    mimeType: string;
    mediaType: "image" | "video" | "audio" | "document";
    bytes: Uint8Array;
  }): Promise<void>;
};

/**
 * 恢复救援包：verify 通过后逐条写入；已存在的 captureId 跳过（幂等），
 * 恢复的记录默认仅本机保存，不自动上传。
 */
export async function importRescuePackage(
  bytes: Uint8Array,
  sink: RescueImportSink,
): Promise<{ imported: number; skipped: number; missingFiles: number }> {
  const { manifest, files } = await verifyRescuePackage(bytes);
  let imported = 0;
  let skipped = 0;
  let missingFiles = 0;
  for (const entry of manifest.captures) {
    if (await sink.captureExists(entry.captureId)) {
      skipped += 1;
      continue;
    }
    if (entry.kind === "text_capture") {
      await sink.restoreText({
        captureId: entry.captureId,
        title: entry.title,
        text: entry.text ?? "",
      });
      imported += 1;
      continue;
    }
    const content = entry.file ? files.get(entry.file) : undefined;
    if (!content) {
      // 清单里声明了文件但包内缺失的条目不写入半成品。
      missingFiles += 1;
      continue;
    }
    await sink.restoreMedia({
      captureId: entry.captureId,
      title: entry.title,
      fileName: entry.fileName ?? entry.captureId,
      mimeType: entry.mimeType ?? "application/octet-stream",
      mediaType: (["image", "video", "audio", "document"] as const).includes(
        entry.mediaType as "image",
      )
        ? (entry.mediaType as "image" | "video" | "audio" | "document")
        : "document",
      bytes: content,
    });
    imported += 1;
  }
  return { imported, skipped, missingFiles };
}
