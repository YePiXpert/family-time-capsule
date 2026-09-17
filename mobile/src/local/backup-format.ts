import { normalizeLibrary, validateLibrary, type Library } from "./model";
export const BACKUP_MAGIC = new TextEncoder().encode("XIAOMEI1");
export const HEADER_LIMIT = 16 * 1024 * 1024;
export type BackupManifest = {
  format: "xiaomei-local";
  version: 1;
  createdAt: string;
  library: Library;
  mediaOrder: string[];
};
export function encodeHeader(library: Library): Uint8Array {
  validateLibrary(library);
  if (Object.values(library.drafts).some((d) => d.recordingFile))
    throw new Error("请先恢复或结束未完成的录音，再备份。");
  const manifest: BackupManifest = {
    format: "xiaomei-local",
    version: 1,
    createdAt: new Date().toISOString(),
    library,
    mediaOrder: Object.keys(library.media).sort(),
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  if (json.length > HEADER_LIMIT) throw new Error("备份清单过大。");
  const header = new Uint8Array(12 + json.length);
  header.set(BACKUP_MAGIC);
  new DataView(header.buffer).setUint32(8, json.length);
  header.set(json, 12);
  return header;
}
export function decodeManifest(json: Uint8Array): BackupManifest {
  if (json.length > HEADER_LIMIT) throw new Error("备份清单过大。");
  const m = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(json),
  ) as BackupManifest;
  if (
    m.format !== "xiaomei-local" ||
    m.version !== 1 ||
    !Array.isArray(m.mediaOrder)
  )
    throw new Error("不是受支持的小美成长记备份。");
  normalizeLibrary(m.library);
  validateLibrary(m.library);
  const ids = Object.keys(m.library.media).sort();
  if (
    m.mediaOrder.length !== ids.length ||
    new Set(m.mediaOrder).size !== ids.length ||
    m.mediaOrder.some((i) => !ids.includes(i)) ||
    Object.values(m.library.drafts).some((d) => d.recordingFile)
  )
    throw new Error("备份素材清单无效。");
  return m;
}