import { anchorFromPrecisionInput } from "@/lib/metadata/precision";
import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import type { DraftContent } from "./model";

type CaptureTime = { capturedAt: Date | null; timeSource: string; type: string };

/** A file modification/import date is never evidence of when a memory happened.
 * Mixed days or incomplete media metadata stay unknown instead of choosing an
 * arbitrary photo. A same-day group supplies a date, not an exact event time. */
export function inferCaptureTime(originals: CaptureTime[], timezone: string): Pick<DraftContent, "occurredAt" | "occurredAtPrecision"> {
  const unknown = { occurredAt: null, occurredAtPrecision: "unknown" as const };
  const media = originals.filter(row => row.type !== "document");
  if (!media.length || media.some(row => !row.capturedAt || !Number.isFinite(row.capturedAt.getTime()) || !["embedded_metadata", "user_confirmed"].includes(row.timeSource))) return unknown;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const days = new Set(media.map(row => date.format(row.capturedAt!)));
  if (days.size !== 1) return unknown;
  const occurredAt = anchorFromPrecisionInput({ precision: "date_only", wall: [...days][0]!, timezone, toUtc: zonedWallTimeToUtc });
  return occurredAt ? { occurredAt: occurredAt.toISOString(), occurredAtPrecision: "date_only" } : unknown;
}
