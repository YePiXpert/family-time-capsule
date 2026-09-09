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

export type MobileSearchTarget =
  | { kind: "memory"; id: string }
  | null;

export function resolveSearchTarget(
  item: Pick<MobileSearchPage["items"][number], "type" | "id" | "eventId">,
): MobileSearchTarget {
  return item.eventId ? { kind: "memory", id: item.eventId } : null;
}
