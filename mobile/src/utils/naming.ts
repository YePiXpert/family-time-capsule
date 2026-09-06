/** Shared by native, Web and mobile API. No clock, filesystem or AI calls. */
export const NAME_SOURCES = ["manual", "accepted_ai", "ai_suggested", "rule_generated", "legacy_unknown"] as const;
export type NameSource = (typeof NAME_SOURCES)[number];
export const NAMING_RULE_VERSION = 1;

export function nameSource(value: unknown): NameSource {
  return NAME_SOURCES.includes(value as NameSource) ? value as NameSource : "legacy_unknown";
}

export function sentenceTitle(text: string, limit = 30): string {
  const clean = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, "").trim();
  const sentence = clean.split(/[\n。！？!?]/u, 1)[0]?.replace(/\s+/gu, " ").trim() ?? "";
  const points = Array.from(sentence);
  return points.length > limit ? `${points.slice(0, limit).join("")}…` : sentence;
}

export type ReadableNameInput = {
  title?: string | null;
  source?: string | null;
  revision?: number;
  text?: string | null;
  mediaType?: string | null;
  originalFilename?: string | null;
  capturedAt?: Date | string | number | null;
  timeSource?: string | null;
  durationMs?: number | null;
  timezone?: string;
  /** For a whole event/bundle, never copy its first asset's filename. */
  assetCount?: number;
  suggestion?: { title: string; valid: boolean; allowed: boolean; targetRevision: number } | null;
};

export function readableName(input: ReadableNameInput): { text: string; source: NameSource; ruleVersion: number; aiSuggested: boolean } {
  const result = (text: string, source: NameSource) => ({ text, source, ruleVersion: NAMING_RULE_VERSION, aiSuggested: source === "ai_suggested" });
  const source = nameSource(input.source);
  // Unknown legacy provenance is protected, even for IMG_* or UUID-looking names.
  if (input.title?.trim() && !["rule_generated", "ai_suggested"].includes(source)) return result(input.title.trim(), source);
  if (input.suggestion?.allowed && input.suggestion.valid && input.suggestion.targetRevision === (input.revision ?? 0) && input.suggestion.title.trim()) {
    return result(input.suggestion.title.trim(), "ai_suggested");
  }
  const sentence = input.text ? sentenceTitle(input.text) : "";
  if (sentence) return result(sentence, "rule_generated");
  const multiple = (input.assetCount ?? 1) > 1;
  const label = multiple ? "一组记忆素材" : ({ image: "照片", audio: "一段录音", video: "一段视频", document: "一份文档" }[input.mediaType ?? ""] ?? "一段记忆");
  if (!multiple && input.mediaType === "document" && input.originalFilename?.trim()) return result(input.originalFilename.trim(), "rule_generated");
  if (!multiple && ["audio", "video"].includes(input.mediaType ?? "") && typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs > 0) {
    const seconds = Math.floor(input.durationMs / 1000);
    return result(`${label} · ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`, "rule_generated");
  }
  if (input.capturedAt != null && input.timeSource !== "import_time" && input.timeSource !== "file_metadata") {
    const date = new Date(input.capturedAt);
    if (Number.isFinite(date.getTime())) {
      try {
        return result(`${label} · ${new Intl.DateTimeFormat("zh-CN", { timeZone: input.timezone ?? "UTC", year: "numeric", month: "long", day: "numeric" }).format(date)}`, "rule_generated");
      } catch { /* Invalid timezone cannot make local content unreadable. */ }
    }
  }
  return result(["audio", "video"].includes(input.mediaType ?? "") && !multiple ? label : `${label} · 时间待补充`, "rule_generated");
}
