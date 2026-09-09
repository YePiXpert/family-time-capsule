import type { LocalTimelineEvent, OutboxItem } from "../types";
import type { LocalDraft } from "../drafts/store";

export function mergeSavedDrafts(events: LocalTimelineEvent[], drafts: LocalDraft[], covers: Record<string, string> = {}): LocalTimelineEvent[] {
  const remoteIds = new Set(events.filter(event => event.source === "server").map(event => event.id));
  const saved = drafts.filter(draft => draft.status === "queued" && (!draft.memoryEventId || !remoteIds.has(draft.memoryEventId)));
  return [...events, ...saved.map((draft): LocalTimelineEvent => ({
    id: `draft:${draft.id}`, localDraftId: draft.id, source: "local", syncState: draft.status === "published" ? null : "pending",
    title: draft.content.title || draft.content.text.trim().slice(0, 60) || "一段成长记录",
    occurredAt: draft.content.occurredAt ?? draft.updatedAt, occurredAtPrecision: draft.content.occurredAt ? draft.content.occurredAtPrecision : "unknown",
    locationText: draft.content.locationText || null, childPersonId: null, ageDays: null, ageLabel: null,
    updatedAt: draft.updatedAt, assetCount: draft.content.items.length, participantNames: [],
    captureIds: draft.content.items.flatMap(item => item.localCaptureRef ? [item.localCaptureRef] : []),
    cover: null, localCoverUri: covers[draft.id] ?? null,
  }))].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
}

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
    childPersonId: null,
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
