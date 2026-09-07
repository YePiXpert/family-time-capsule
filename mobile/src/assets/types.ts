export type LibraryAsset = {
  id: string; title: string; type: "image" | "audio" | "video" | "document";
  mimeType: string; previewId: string | null; capturedAt: string | null;
  referenced: boolean; syncState: "received"; aiState: string;
};
export type LibraryPage = { pendingDeletions: { id: string }[]; entries: LibraryAsset[]; nextCursor: string | null; canWrite: boolean; canCapture: boolean };
export type LibraryDetail = LibraryAsset & {
  metadataRevision: number; nameRevision: number; participantIds: string[];
  canWrite: boolean; canCapture: boolean; canDelete: boolean;
  memories: { id: string; title: string }[];
  technical: { importSources: string[]; originalFilename: string; sha256: string; bytes: number; width: number | null; height: number | null; durationMs: number | null; metadataJson: string | null; importedAt: string; timeSource: string };
};
