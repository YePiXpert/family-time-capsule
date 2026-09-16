import { ApiError } from "../api/client";
import type { Credentials } from "../types";
import { ReadingError, type DownloadEntry } from "./engine";
import { invalidateReadingCredentials, nativeReadingStore, readingFileUri, resolveReadingScope } from "./native";
import type { ReadingKind } from "./types";

export type ShelfPage = {
  entries: { id: string }[];
  nextCursor: string | null;
  canWrite: boolean;
};

export type ReadingShelf<P extends ShelfPage> = {
  page: P | null;
  downloads: DownloadEntry[];
  offline: boolean;
};

/** Only a known network failure can expose the previously verified reading copy. */
export async function loadReadingShelf<P extends ShelfPage>({
  credentials,
  connected,
  kind,
  deleted,
  familyId,
  userId,
  fetchPage,
}: {
  credentials: Credentials;
  connected: boolean | null | undefined;
  kind: ReadingKind;
  deleted: boolean;
  familyId?: string;
  userId?: string;
  fetchPage: () => Promise<P>;
}): Promise<ReadingShelf<P>> {
  if (connected !== false) {
    try {
      return { page: await fetchPage(), downloads: [], offline: false };
    } catch (error) {
      // Authentication, deletion and server errors must never be treated as offline.
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        await invalidateReadingCredentials(credentials);
      }
      if (!(error instanceof ApiError) || error.status !== 0) throw error;
    }
  }
  if (deleted) throw new ReadingError("联网后可以查看回收站。");
  const { scope, online } = await resolveReadingScope(credentials, {
    offline: connected === false,
  });
  if (online) throw new ReadingError("暂时无法读取列表，请重试。");
  if ((familyId && scope.familyId !== familyId) || (userId && scope.userId !== userId)) {
    throw new ReadingError("请连接原来的家庭账号后查看下载。", 403);
  }
  const summaries = await nativeReadingStore.list(scope.key);
  const entries = await Promise.all(summaries
    .filter(row => row.scope === scope.key && row.kind === kind && row.state === "ready")
    .map(row => nativeReadingStore.get(row.key)));
  const downloads = entries.filter((entry): entry is DownloadEntry => !!entry &&
    entry.scope === scope.key && entry.kind === kind && entry.state === "ready" &&
    entry.key === `${scope.key}/${kind}-${entry.id}` &&
    entry.manifest.kind === kind && entry.manifest.id === entry.id &&
    entry.manifest.userId === scope.userId && entry.manifest.familyId === scope.familyId);
  return { page: null, downloads, offline: true };
}

/** Prefer the explicit book cover; albums use the first downloaded photo. */
export function downloadedCoverUri(entry: DownloadEntry): string | undefined {
  const imageIds = entry.manifest.chapters.flatMap(chapter => chapter.blocks.flatMap(block => block.images));
  const image = imageIds.map(id => entry.manifest.media.find(media => media.id === id && media.type === "image"))
    .find(media => media && entry.completed.includes(media.id));
  return image ? readingFileUri(entry.key, image) : undefined;
}
