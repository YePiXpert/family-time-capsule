export type AlbumSyncCommand = {
  mutationId: string;
  target:
    | {
        clientAlbumId: string;
        title: string;
        publishMetadata: true;
        coverAssetId?: string | null;
      }
    | { collectionId: string; baseRevision: number };
  items: { clientItemId: string; memoryEventId: string }[];
};
export type AlbumSyncResult = {
  id: string;
  revision: number;
  items: { clientItemId: string; itemId: string; memoryEventId: string }[];
};
