import type { Library, LocalMedia, Stored } from "./model";
import { mediaFile } from "./files";

type Loader = (
  media: Stored<LocalMedia>,
  signal?: AbortSignal,
) => Promise<void>;
let loader: Loader | undefined;
/** Composition-root injection: the local library never reads family secrets or performs network calls. */
export function installAttachmentLoader(value: Loader): () => void {
  loader = value;
  return () => {
    if (loader === value) loader = undefined;
  };
}
export function attachmentAvailable(media: Stored<LocalMedia>): boolean {
  const file = mediaFile(media);
  return file.exists && file.size === media.bytes;
}
export async function ensureAttachment(
  media: Stored<LocalMedia>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new Error("已停止。");
  if (attachmentAvailable(media)) return;
  if (!media.remote) throw new Error(`素材缺失或损坏：${media.name}`);
  if (!loader) throw new Error("原件尚未下载，请加入家庭并联网后重试。");
  await loader(media, signal);
  if (!attachmentAvailable(media))
    throw new Error("原件还没有完整下载，请重试。");
}
export async function ensureAllAttachments(
  state: Library,
  progress?: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const missing = Object.values(state.media).filter(
    (m) => !attachmentAvailable(m),
  );
  for (const [i, m] of missing.entries()) {
    progress?.(`正在补齐原件 ${i + 1}/${missing.length}`);
    await ensureAttachment(m, signal);
  }
}
