import type { LocalTimelineEvent } from "../types";

export function timelineRecordKey(record: LocalTimelineEvent): string {
  return record.localDraftId ? `draft:${record.localDraftId}` : record.id;
}

export function findSavedRecord(events: readonly LocalTimelineEvent[], draftId: string) {
  return events.find(event => event.localDraftId === draftId || event.id === `draft:${draftId}`);
}
