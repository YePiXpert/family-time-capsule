export type CollectionEdit = {
  title: string;
  kind: "album" | "chapter";
  description: string;
  coverAssetId: string | null;
  startDate: string | null;
  endDate: string | null;
  sortMode: "manual" | "time";
  sections: { id: string; title: string }[];
  items: {
    id: string;
    memoryEventId: string | null;
    sectionId: string | null;
    caption: string;
  }[];
};
export type CollectionDetail = Omit<CollectionEdit, "items"> & {
  id: string;
  revision: number;
  timezone: string;
  updatedAt: string;
  deletedAt: string | null;
  canWrite: boolean;
  items: (CollectionEdit["items"][number] & {
    source: {
      title: string;
      occurredAt: string;
      coverAssetId: string | null;
      previewAssetId: string | null;
    } | null;
  })[];
};
export type CollectionPage = {
  entries: {
    id: string;
    title: string;
    kind: "album" | "chapter";
    description: string;
    count: number;
    coverAssetId: string | null;
    revision: number;
    deletedAt: string | null;
  }[];
  nextCursor: string | null;
  canWrite: boolean;
};
