export type Credentials = {
  /** Missing only on older installations until the first online identity check. */
  instanceId?: string;
  serverUrl: string;
  token: string;
};

export type Viewer = {
  id: string;
  name: string;
  role: "admin" | "editor" | "contributor" | "viewer";
  personId: string | null;
  canCapture: boolean;
  canReviewInbox: boolean;
  canCreateContributions: boolean;
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
  childPersonId: string | null;
  ageDays: number | null;
  ageLabel: string | null;
  updatedAt: string;
  assetCount: number;
  participantNames: string[];
  captureIds: string[];
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
  tombstones?: { kind: "memory" | "person"; id: string }[];
  sync?: {
    protocol: 2; mode: "snapshot" | "delta"; generation: string;
    permissionStamp: string; checkpoint: string | null; invalidateResources: boolean;
  };
};

export type LocalTimelineEvent = TimelineEvent & {
  localCoverUri: string | null;
  source: "server" | "local";
  syncState: "pending" | "inbox" | null;
};

export type TextCapturePayload = {
  text: string;
  importSessionId?: string;
};

export type MediaCapturePayload = {
  localUri: string;
  fileName: string;
  mimeType: string;
  lastModified: number | null;
  mediaType: "image" | "video" | "audio" | "document";
  source: "camera" | "library" | "recorder" | "files" | "system_share";
  uploadId?: string;
  uploadOffset?: number;
  /** Derived from the relational local_import_item when flushing the outbox. */
  importSessionId?: string;
};

export type LocalImportSource = "files" | "share";

export type LocalImportIntakeItem = {
  sortOrder?: number;
  externalId: string;
  captureId: string;
  kind: "file" | "text" | "error";
  payload?: MediaCapturePayload | TextCapturePayload;
  localUri?: string;
  error?: string;
};

export type LocalImportSession = {
  id: string;
  source: LocalImportSource;
  status: "collecting" | "uploading" | "reviewing" | "completed" | "cancelled";
  totalCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
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
  voices?: {
    id: string;
    memoryEventId: string;
    eventTitle: string;
    authorName: string;
    audioPath: string;
  }[];
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
  monthlyReview?: {month:string;startDate:string;endDate:string;count:number};
  activeBooks?: {id:string;title:string;subtitle:string}[];
  weeklyReview: {
    key: string;
    status: string;
    confirmedCount: number;
    pendingInboxCount: number;
    storyId: string | null;
  };
  isFirstUse: boolean;
};

export type MobileInboxAsset = {
  id: string;
  type: "image" | "video" | "audio" | "document";
  filename: string;
  mimeType: string;
  capturedAt: string | null;
  mediaPath: string;
  thumbnailPath: string | null;
};

export type MobileInboxEntry = {
  id: string;
  titleRevision?: number;
  kind: "text" | "asset" | "bundle";
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
  type: "image" | "video" | "audio" | "document";
  filename: string;
  mimeType: string;
  durationMs: number | null;
  mediaPath: string;
  thumbnailPath: string | null;
};

export type MobileContributionVisibility =
  | "private"
  | "parents"
  | "family"
  | "child_later";

export type MobileMemoryPatch = {
  expectedRevision: number;
  mutationId: string;
  title?: string;
  bodyText?: string;
  occurredAtWall?: string;
  occurredAtPrecision?: import("./utils/occurred-precision").OccurredAtPrecision;
  locationText?: string | null;
  coverAssetId?: string | null;
  childPersonId?: string | null;
  participantPersonIds?: string[];
  milestoneType?: string | null;
  isPinned?: boolean;
};

export type MemorySharingPatch = { visibility: "private" | "members" | "family"; readerUserIds: string[]; expectedRevision: number; mutationId: string };
export type MemorySharingResult = { visibility: MemorySharingPatch["visibility"]; readerUserIds: string[]; titleRevision: number; readable: boolean };

export type MobileMemory = {
  bodyText?: string;
  canWrite?: boolean;
  isAuthor?: boolean;
  visibility?: "private" | "members" | "family";
  readerUserIds?: string[];
  /** Absent only in legacy cached details; editing requires a current version. */
  titleRevision?: number;
  id: string;
  title: string;
  occurredAt: string;
  occurredAtWall: string;
  occurredAtPrecision: string;
  ageDays: number | null;
  ageLabel: string | null;
  locationText: string | null;
  childPersonId: string | null;
  participantPersonIds: string[];
  participants: {
    id: string;
    displayName: string;
    relationToChild: string | null;
    isChild: boolean;
  }[];
  livePhotos?: { groupId: string; imageAssetId: string; videoAssetId: string }[];
  sourceNotes: { id: string; text: string }[];
  assets: MobileMemoryAsset[];
  contributions: {
    id: string;
    authorPersonId: string;
    authorName: string;
    text: string;
    visibility: MobileContributionVisibility;
    canEdit: boolean;
    audioPath: string | null;
    createdAt?: string;
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
  expectedTitleRevision?: number;
  childPersonId?: string | null;
  title?: string | null;
  occurredAtWall?: string | null;
  locationText?: string | null;
  participantPersonIds?: string[];
};

export type MobileContributionInput = {
  authorPersonId: string;
  text: string;
  visibility: MobileContributionVisibility;
};

export type MobileLibraryDomain =
  | "people"
  | "stories"
  | "capsules"
  | "requests"
  | "portals"
  | "imports";

export type MobileLibraryItem = {
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  updatedAt: string;
  meta: Record<string, string | number | boolean | null>;
};

export type MobileLibraryPage = {
  items: MobileLibraryItem[];
  nextCursor: string | null;
};

export type MobileLibraryDetail = Record<string, unknown> & {
  id: string;
  title: string;
};

export type MobileLibraryMutationResult = {
  success?: boolean;
  id?: string;
  token?: string;
  expiresAt?: string;
};

export type MobileReview = {
  id: string;
  key: string;
  periodStart: string;
  periodEnd: string;
  status: "open" | "in_progress" | "completed";
  storyId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  canWrite: boolean;
  preferences: {
    timezone: string;
    weekStartsOn: number;
    reminderWeekday: number;
    reminderLocalTime: string;
    remindPendingInbox: boolean;
    remindPendingRequests: boolean;
    remindUpcomingCapsules: boolean;
  };
  counts: {
    inbox: number;
    needsReview: number;
    duplicateSuggestions: number;
    clusterSuggestions: number;
    guestSubmissions: number;
    failedImports: number;
    pendingRequests: number;
    upcomingCapsules: number;
  };
  reminderAt: string | null;
  events: {
    id: string;
    title: string;
    occurredAt: string;
    locationText: string | null;
    participantNames: string[];
    milestoneType: string | null;
    contributionCount: number;
    selected: boolean;
  }[];
};

export type MobileCalendar = {
  month: string;
  timezone: string;
  days: { date: string; count: number; covers: { date: string; eventId: string; assetId: string }[] }[];
  entries: { id: string; title: string; occurredAt: string; date: string }[];
  nextCursor: string | null;
  people: { id: string; name: string }[];
  ages: { label: string; date: string }[];
};

export type BootstrapSetupState = "available" | "completed" | "unconfigured";

/** GET /api/bootstrap 的最小实例识别信息（1.3）。 */
export type BootstrapInfo = {
  product: string;
  apiVersion: number;
  instanceId: string;
  setup: { state: BootstrapSetupState };
};

/** GET /api/mobile/v1/me 的账号与家庭状态（1.3）。 */
export type MobileMe =
  | { status: "needsOnboarding"; user: { id: string; displayName: string; email: string }; account: { role: string } }
  | {
      status: "ready";
      user: { id: string; displayName: string; email: string };
      account: { role: string; personId: string | null; isGuardian: boolean };
      family: { id: string; name: string; timezone: string };
    }
  | { status: "revoked" };

/** POST /api/mobile/v1/onboarding 的输入（与服务端 OnboardingInput 对齐）。 */
export type OnboardingInput = {
  familyName: string;
  timezone: string;
  childDisplayName: string;
  childBirthDate: string;
  selfDisplayName: string;
  selfRelationToChild: string;
  selfIsGuardian: boolean;
};

/** GET /api/invitations/preview 的受限预览信息（1.3）。 */
export type InvitationPreview =
  | { status: "invalid" }
  | {
      status: "active" | "claimed" | "expired" | "revoked" | "used";
      familyName: string;
      role: string;
      email: string | null;
      personName: string | null;
      expiresAt: string;
    };

export type InvitationCreateInput = {
  role: "admin" | "editor" | "contributor" | "viewer";
  expiresInDays: number;
  email?: string;
  personId?: string;
};

export type InvitationCreateResult = {
  invitationId: string;
  token: string;
  invitePath: string;
  expiresAt: string;
};

/**
 * 首次同步授权（M4）：上传本机记录前，用户对“目的地”的明确同意。
 * - scope "all"：目的地允许上传全部本机待传记录；
 * - scope "selected"：仅上传 ids 中的记录；
 * - scope "local"：明确选择仅保留本机（不等于暂停，暂停用另一个标志）。
 * 目的地 = serverUrl + instanceId + 账号 + 家庭；切换实例/账号/家庭后需重新核对。
 */
export type SyncConsent = {
  instanceId?: string;
  serverUrl: string;
  userId: string;
  familyId: string | null;
  scope: "all" | "selected" | "local";
  ids: string[];
  decidedAt: string;
};
