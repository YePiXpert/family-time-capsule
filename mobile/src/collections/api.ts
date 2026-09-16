import { ApiError, requestMobileJson } from "../api/client";
import type { Credentials } from "../types";
import type { AlbumSyncCommand, AlbumSyncResult } from "./sync-types";
export async function sendAlbumCommand(
  credentials: Credentials,
  command: AlbumSyncCommand,
): Promise<AlbumSyncResult> {
  const r = (await requestMobileJson(credentials, "/api/collections/sync", {
    method: "POST",
    body: JSON.stringify(command),
  })) as AlbumSyncResult;
  if (
    !r ||
    typeof r.id !== "string" ||
    !Number.isSafeInteger(r.revision) ||
    !Array.isArray(r.items) ||
    r.items.length !== command.items.length ||
    command.items.some(
      (i) =>
        !r.items.some(
          (j) =>
            j.clientItemId === i.clientItemId &&
            j.memoryEventId === i.memoryEventId &&
            typeof j.itemId === "string",
        ),
    )
  )
    throw new ApiError("服务器尚未确认相册内容，待办已保留。", 502);
  return r;
}
