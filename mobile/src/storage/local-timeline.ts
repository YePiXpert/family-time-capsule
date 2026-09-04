import type { LocalTimelineEvent, OutboxItem } from "../types";

export type LocalCaptureRow = {
  id: string;
  kind: OutboxItem["kind"];
  title: string;
  occurred_at: string;
  local_uri: string | null;
  media_type: "image" | "video" | "audio" | "document" | null;
  inbox_item_id: string | null;
  memory_event_id: string | null;
  sync_state: "pending" | "inbox" | "archived";
};

export function toLocalTimelineEvent(row: LocalCaptureRow): LocalTimelineEvent {
  const isMedia = row.kind === "media_capture";
  return {
    id: `local:${row.id}`,
    title: row.title,
    occurredAt: row.occurred_at,
    occurredAtPrecision: "exact",
    locationText: null,
    childPersonId: "local",
    ageDays: null,
    ageLabel: null,
    updatedAt: row.occurred_at,
    assetCount: isMedia ? 1 : 0,
    participantNames: [],
    captureIds: [row.inbox_item_id ?? row.id],
    cover: null,
    localCoverUri:
      isMedia && row.media_type === "image" ? row.local_uri : null,
    source: "local",
    syncState: row.sync_state === "archived" ? null : row.sync_state,
  };
}

export function mergeTimelineEvents(
  serverEvents: LocalTimelineEvent[],
  localRows: LocalCaptureRow[],
): LocalTimelineEvent[] {
  return [
    ...serverEvents,
    ...localRows
      .filter((row) => row.sync_state !== "archived")
      .map(toLocalTimelineEvent),
  ].sort((a, b) =>
    a.occurredAt === b.occurredAt
      ? b.id.localeCompare(a.id)
      : b.occurredAt.localeCompare(a.occurredAt),
  );
}
