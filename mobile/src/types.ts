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
  ageLabel: string | null;
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
  lastModified: number | null;
  mediaType: "image" | "video" | "audio";
  source: "camera" | "library" | "recorder";
};

export type OutboxItem = {
  id: string;
  kind: "text_capture" | "media_capture";
  payload: TextCapturePayload | MediaCapturePayload;
  createdAt: string;
  attemptCount: number;
  lastError: string | null;
};

export type MobileHome = {
  family: { name: string; timezone: string };
  child: null | {
    id: string;
    displayName: string;
    currentAgeLabel: string | null;
    avatarPath: string | null;
  };
  capabilities: { canCapture: boolean };
  inbox: {
    count: number;
    previews: {
      id: string;
      title: string;
      status: string;
      mediaPath: string | null;
    }[];
  };
  recentMemories: {
    id: string;
    title: string;
    occurredAt: string;
    ageLabel: string | null;
    coverPath: string | null;
  }[];
  onThisDay: { id: string; title: string; occurredAt: string }[];
  story: null | { id: string; title: string; status: string };
  capsule: null | {
    id: string;
    title: string;
    status: string;
    unlockType: string;
    unlockValue: string;
    unlocked: boolean;
  };
  prompt: {
    text: string;
    recipientLabel: string | null;
    pendingCount: number;
    isCreatedRequest: boolean;
  };
  isFirstUse: boolean;
};

export type MobileInboxAsset = {
  id: string;
  type: "image" | "video" | "audio";
  filename: string;
  mimeType: string;
  capturedAt: string | null;
  mediaPath: string;
  thumbnailPath: string | null;
};

export type MobileInboxEntry = {
  id: string;
  kind: "text" | "asset";
  status: string;
  title: string;
  rawText: string | null;
  occurredAt: string | null;
  occurredAtWall: string | null;
  locationText: string | null;
  participantPersonIds: string[];
  createdAt: string;
  assets: MobileInboxAsset[];
};

export type MobileInboxPage = {
  entries: MobileInboxEntry[];
  nextCursor: string | null;
};

export type MobileMemoryAsset = {
  id: string;
  type: "image" | "video" | "audio";
  filename: string;
  mimeType: string;
  durationMs: number | null;
  mediaPath: string;
  thumbnailPath: string | null;
};

export type MobileMemory = {
  id: string;
  title: string;
  occurredAt: string;
  occurredAtWall: string;
  occurredAtPrecision: string;
  ageDays: number | null;
  ageLabel: string | null;
  locationText: string | null;
  childPersonId: string;
  participantPersonIds: string[];
  participants: {
    id: string;
    displayName: string;
    relationToChild: string | null;
    isChild: boolean;
  }[];
  sourceNotes: { id: string; text: string }[];
  assets: MobileMemoryAsset[];
  contributions: {
    id: string;
    authorPersonId: string;
    authorName: string;
    text: string;
    visibility: "private" | "parents" | "family" | "child_later";
    canEdit: boolean;
    audioPath: string | null;
  }[];
  updatedAt: string;
};

export type MobileSearchPage = {
  items: {
    type: "memory" | "fact" | "contribution" | "transcript" | "story";
    id: string;
    eventId: string | null;
    title: string;
    snippet: string;
  }[];
  nextCursor: string | null;
};

export type InboxDraftPatch = {
  title?: string | null;
  occurredAtWall?: string | null;
  locationText?: string | null;
  participantPersonIds?: string[];
};
