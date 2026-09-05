export type BookTemplate = "photos" | "growth" | "letters";
export type BookAudience = "personal" | "family";
export type BookSourceKind =
  "memory" | "asset" | "contribution" | "story" | "collection";
export type BookSourceRef = {
  id: string;
  kind: BookSourceKind;
  memoryEventId: string | null;
  assetId: string | null;
  contributionId: string | null;
  storyId: string | null;
  collectionId: string | null;
  fingerprint: string;
  label: string;
};
export type BookLayout = {
  breakBefore: boolean;
  fit: "contain" | "cover";
  focus: { x: number; y: number }[];
};
export type BookBlock = {
  id: string;
  chapterId: string;
  kind: "text" | "image" | "double" | "collage" | "quote" | "date";
  text: string;
  caption: string;
  layout: BookLayout;
  sourceIds: string[];
};
export type BookEdit = {
  title: string;
  subtitle: string;
  template: BookTemplate;
  audience: BookAudience;
  pageSize: "A4" | "A5";
  startDate: string | null;
  endDate: string | null;
  coverAssetId: string | null;
  chapters: { id: string; title: string }[];
  blocks: BookBlock[];
  sources: BookSourceRef[];
};
export type BookSourceState = {
  available: boolean;
  changed: boolean;
  label: string;
  occurredAt: string | null;
  ageLabel: string | null;
  author: string | null;
  asset: {
    id: string;
    filename: string;
    mimeType: string;
    type: string;
    width: number | null;
    height: number | null;
    bytes: number;
    previewAssetId: string | null;
  } | null;
};
export type BookDetail = BookEdit & {
  id: string;
  revision: number;
  ownerPersonId: string | null;
  status: "active" | "finished";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  canWrite: boolean;
  timezone: string;
  sourceStates: Record<string, BookSourceState>;
  blockedBlockIds: string[];
  warnings: {
    blockId: string | null;
    code:
      | "missing_source"
      | "source_changed"
      | "low_resolution"
      | "long_text"
      | "empty_block"
      | "empty_chapter";
  }[];
  versions: { revision: number; createdAt: string }[];
};
export type BookPage = {
  entries: {
    id: string;
    title: string;
    subtitle: string;
    template: BookTemplate;
    audience: BookAudience;
    revision: number;
    updatedAt: string;
    status: "active" | "finished";
  }[];
  nextCursor: string | null;
  canWrite: boolean;
};
export const BOOK_TEMPLATES: {
  id: BookTemplate;
  title: string;
  description: string;
}[] = [
  {
    id: "photos",
    title: "照片相册",
    description: "照片优先，用少量说明串起那段日子。",
  },
  {
    id: "growth",
    title: "图文成长册",
    description: "按日期编排照片、原话和成长片段。",
  },
  {
    id: "letters",
    title: "家人来信集",
    description: "以每位家人的讲述为中心，留下署名和日期。",
  },
];
export function defaultBookLayout(): BookLayout {
  return {
    breakBefore: false,
    fit: "contain",
    focus: [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ],
  };
}
