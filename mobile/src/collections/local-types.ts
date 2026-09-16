import type { AlbumSyncCommand } from "./sync-types";
export type MaterialRef =
  | { kind: "localDraft"; scope: string; id: string }
  | { kind: "memory" | "collection"; scope: string; id: string };
export type AlbumItem = { id: string; ref: MaterialRef; remoteItemId?: string };
export type LocalAlbum = {
  id: string;
  scope: string;
  title: string;
  items: AlbumItem[];
  coverItemId: string | null;
  revision: number;
  updatedAt: string;
  remoteId: string | null;
  remoteRevision: number;
  consent: { scope: string; at: string; draftIds: string[] } | null;
  pending: {
    mutationId: string;
    itemIds: string[];
    command?: AlbumSyncCommand;
  } | null;
  error: string;
  syncRejected?: boolean;
};
