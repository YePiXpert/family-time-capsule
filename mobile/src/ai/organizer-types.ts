import type { AiSettings } from "./types";
import type { NameReview } from "../names/types";
export type OrganizerKind = "memory_event" | "inbox_item" | "asset";
export type OrganizerTarget = { kind: OrganizerKind; id: string };
export type OrganizerOperation = "name" | "transcribe" | "cancel" | "retry" | "regenerate";
export type OrganizerTask = {
  id: string;
  state: "waiting_analysis" | "analyzing" | "waiting_naming" | "naming" | "ready" | "insufficient" | "failed" | "cancelled" | "cancelling";
  active: boolean;
  message: string;
  steps: { label: string; status: "pending" | "running" | "completed" | "failed" | "cancelled" }[];
  canCancel: boolean;
  canRetry: boolean;
  canRegenerate: boolean;
};
export type OrganizerReview = {
  target: OrganizerTarget;
  settings: AiSettings;
  tasks: OrganizerTask[];
  names: NameReview | null;
  transcripts: { assetId: string; text: string; edited: boolean; revision: number }[];
};
