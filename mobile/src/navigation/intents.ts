import type { MobileSearchPage } from "../types";

export type CaptureIntent = "text" | "photo" | "audio" | "library";

export const HOME_CAPTURE_ACTIONS: readonly {
  label: string;
  hint: string;
  intent: CaptureIntent;
}[] = [
  { label: "文字", hint: "写下一刻", intent: "text" },
  { label: "拍照", hint: "保留原片", intent: "photo" },
  { label: "录音", hint: "留下声音", intent: "audio" },
  { label: "导入", hint: "相册多选", intent: "library" },
];

export function homeWebPath(
  kind: "story" | "capsule" | "prompt",
  id: string | null,
): string {
  if (kind === "story" && id) return `/stories/${encodeURIComponent(id)}`;
  if (kind === "capsule" && id) return `/capsules/${encodeURIComponent(id)}`;
  return kind === "prompt" ? "/requests" : kind === "story" ? "/stories" : "/capsules";
}

export type MobileSearchTarget =
  | { kind: "memory"; id: string }
  | { kind: "web"; path: string }
  | null;

export function resolveSearchTarget(
  item: Pick<MobileSearchPage["items"][number], "type" | "id" | "eventId">,
): MobileSearchTarget {
  if (item.type === "story") {
    return { kind: "web", path: `/stories/${encodeURIComponent(item.id)}` };
  }
  return item.eventId ? { kind: "memory", id: item.eventId } : null;
}
