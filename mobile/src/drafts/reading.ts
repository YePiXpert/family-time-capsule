import type { Credentials } from "../types";
import type { LocalDraft } from "./store";

/** Local drafts are private to the same verified account/family as capture. */
export function draftReadingScope(credentials: Credentials | null, userId?: string | null, viewerId?: string | null, familyId?: string | null): string | null {
  if (!credentials) return "local";
  const owner = userId ?? viewerId;
  if (!credentials.instanceId || !owner || !familyId || (userId && viewerId && userId !== viewerId)) return null;
  return JSON.stringify([credentials.serverUrl, credentials.instanceId, owner, familyId]);
}

/** Unsubmitted edits never replace the last explicitly saved reading copy. */
export function savedDraftContent(draft: LocalDraft) {
  if (draft.status === "queued") return draft.content;
  if (draft.status === "editing") return draft.savedContent ?? null;
  return null; // A published/revoked remote record must not reappear from an old draft.
}
