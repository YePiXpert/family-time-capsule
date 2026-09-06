export type TranscriptReview = {
  assetId: string;
  canEdit: boolean;
  transcript: null | { text: string; edited: boolean; revision: number; segments: { startSeconds: number; endSeconds: number; text: string }[] };
};
