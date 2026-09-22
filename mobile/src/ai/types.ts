export type WritingMode = "polish" | "recap" | "ask" | "question" | "editor";
export type AIResult = { title?: string; text?: string; questions?: string[]; first?: boolean; question?: string };
export type AIJob = {
  fingerprint: string;
  kind: "write";
  eventIndex: number;
  model: string;
  writingMode: WritingMode;
  steps: { key: string; requestId: string; result?: AIResult }[];
};
export type AIProposal = AIResult & {
  fingerprint: string;
  kind: "write";
  eventIndex: number;
  model: string;
  writingMode: WritingMode;
};
export type Member = {
  id: string;
  name: string;
  role: "owner" | "member";
  enabled: number;
  photo_limit: number;
  write_limit: number;
  username?: string | null;
  deviceId?: string;
};
export type Usage = {
  photos: number;
  writes: number;
  calls: number;
  tokens: number;
};
export type AISettings = {
  paused: boolean;
  defaultModel: string;
  enabledModels: string[];
  globalPhotos: number;
  globalWrites: number;
};
export type Overview = {
  members: (Member & { usage: Usage })[];
  devices: {
    id: string;
    member_id: string;
    name: string;
    revoked: number;
    created_at: number;
  }[];
  usage: Usage;
  settings: AISettings;
  availableModels: string[];
  recent: {
    day: string;
    model: string;
    calls: number;
    photos: number;
    writes: number;
    tokens: number | null;
    status: string;
  }[];
};
