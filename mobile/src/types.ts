export type Credentials = {
  serverUrl: string;
  token: string;
};

export type Viewer = {
  id: string;
  name: string;
  role: "admin" | "editor" | "contributor" | "viewer";
  canCapture: boolean;
  canEditEvents: boolean;
};

export type Family = {
  id: string;
  name: string;
  timezone: string;
};

export type Person = {
  id: string;
  displayName: string;
  relationToChild: string | null;
  isChild: boolean;
  birthDate: string | null;
  updatedAt: string;
};

export type TimelineEvent = {
  id: string;
  title: string;
  occurredAt: string;
  occurredAtPrecision: string;
  locationText: string | null;
  childPersonId: string;
  ageDays: number | null;
  updatedAt: string;
  assetCount: number;
  participantNames: string[];
  cover: null | {
    assetId: string;
    mediaAssetId: string;
    type: string | null;
    mimeType: string | null;
    path: string;
  };
};

export type SyncPage = {
  apiVersion: 1;
  serverTime: string;
  viewer: Viewer;
  family: Family;
  people: Person[];
  events: TimelineEvent[];
  nextCursor: string | null;
};

export type LocalTimelineEvent = TimelineEvent & {
  localCoverUri: string | null;
  source: "server" | "local";
  syncState: "pending" | "synced" | null;
};

export type TextCapturePayload = {
  text: string;
};

export type MediaCapturePayload = {
  localUri: string;
  fileName: string;
  mimeType: string;
  lastModified: number;
  mediaType: "image" | "video";
};

export type OutboxItem = {
  id: string;
  kind: "text_capture" | "media_capture";
  payload: TextCapturePayload | MediaCapturePayload;
  createdAt: string;
  attemptCount: number;
  lastError: string | null;
};
