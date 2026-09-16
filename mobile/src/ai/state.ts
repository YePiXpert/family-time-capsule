import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Library, RecordDraft, RecordContent } from "../local/model";
import { photoDayGroups } from "../local/photo-metadata";
import type { AIGroup, AIProposal, AIResult } from "./types";
export function sourceFingerprint(draft: RecordDraft, media: Library["media"]) {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify({
          content: draft.content,
          events: draft.photoEvents,
          group: draft.groupPhotosByDay,
          photos: draft.content.mediaIds.map((id) => ({
            id,
            hash: media[id]?.sha256,
            metadata: media[id]?.photoMetadata,
          })),
        }),
      ),
    ),
  );
}
export function validateResult(
  value: unknown,
  kind: "group" | "write",
  ids: string[],
): AIResult {
  if (!value || typeof value !== "object") throw new Error("AI 建议无效。");
  const result = value as AIResult;
  if (kind === "write") {
    if (
      typeof result.title !== "string" ||
      result.title.length > 100 ||
      typeof result.text !== "string" ||
      result.text.length > 2000
    )
      throw new Error("AI 文案不完整。");
    return { title: result.title, text: result.text };
  }
  if (
    !Array.isArray(result.groups) ||
    !result.groups.length ||
    result.groups.length > 100
  )
    throw new Error("AI 分组不完整。");
  const groups = result.groups;
  for (const g of groups)
    if (
      !g ||
      typeof g.title !== "string" ||
      g.title.length > 100 ||
      typeof g.summary !== "string" ||
      g.summary.length > 600 ||
      !Array.isArray(g.photoIds) ||
      !g.photoIds.length ||
      g.photoIds.some((id) => typeof id !== "string")
    )
      throw new Error("AI 分组内容无效。");
  const actual = groups.flatMap((g) => g.photoIds);
  if (
    actual.length !== ids.length ||
    new Set(actual).size !== actual.length ||
    actual.some((id) => !ids.includes(id))
  )
    throw new Error("AI 分组有遗漏或重复，请重试。");
  return { groups };
}
export function proposalEvents(
  draft: RecordDraft,
  media: Library["media"],
  proposal: AIProposal,
): RecordContent[] {
  if (sourceFingerprint(draft, media) !== proposal.fingerprint)
    throw new Error("你已修改照片或记录内容，请重新生成建议，当前编辑已保留。");
  const existing = photoDayGroups(draft, media);
  if (proposal.kind === "write") {
    const selected = existing[proposal.eventIndex];
    if (!selected) throw new Error("这件事已改变，请重新生成。");
    existing[proposal.eventIndex] = {
      ...selected,
      title: proposal.title ?? selected.title,
      text: proposal.text ?? selected.text,
    };
    return existing;
  }
  const images = draft.content.mediaIds.filter(
    (id) => media[id]?.kind === "image",
  );
  const groups = validateResult(proposal, "group", images).groups!;
  const mapped = groups.map((g): RecordContent => {
    const dated = g.photoIds
      .map((id) => media[id]?.photoMetadata?.capturedAt)
      .filter((date): date is string => !!date);
    if (new Set(dated.map((date) => date.slice(0, 10))).size > 1)
      throw new Error("建议混合了不同日期，请重新整理。");
    // Existing text stays with its original event; do not duplicate or silently discard edits.
    const source = existing.find((e) =>
      e.mediaIds.some((id) => g.photoIds.includes(id)),
    );
    const location = source?.location ?? "";
    return {
      title: g.title,
      text: "",
      date: dated[0] ?? source?.date ?? draft.content.date,
      location,
      first: false,
      mediaIds: g.photoIds,
      coverId: g.photoIds[0] ?? null,
    };
  });
  // Preserve each existing caption once, in the new event containing its first media item.
  for (const event of existing) {
    const target = mapped.find((g) =>
      event.mediaIds.some((id) => g.mediaIds.includes(id)),
    );
    if (target && event.text.trim())
      target.text = [target.text, event.text].filter(Boolean).join("\n\n");
    if (target && event.title.trim()) target.title = event.title;
  }
  for (const event of existing) {
    const otherIds = event.mediaIds.filter((id) => media[id]?.kind !== "image");
    if (otherIds.length)
      mapped.push({
        ...event,
        mediaIds: otherIds,
        coverId: null,
        text: event.mediaIds.some((id) => media[id]?.kind === "image")
          ? ""
          : event.text,
      });
  }
  return mapped;
}
export function sameDayChunks(ids: string[], media: Library["media"]) {
  const days = new Map<string, string[]>();
  for (const id of ids) {
    const key = media[id]?.photoMetadata?.capturedAt?.slice(0, 10) ?? "undated";
    const group = days.get(key) ?? [];
    group.push(id);
    days.set(key, group);
  }
  return [...days].map(([day, photos]) => ({
    day,
    chunks: photos
      .sort((a, b) =>
        (media[a]?.photoMetadata?.capturedAt ?? "").localeCompare(
          media[b]?.photoMetadata?.capturedAt ?? "",
        ),
      )
      .reduce<string[][]>((chunks, id, index) => {
        if (index % 20 === 0) chunks.push([]);
        chunks[chunks.length - 1]!.push(id);
        return chunks;
      }, []),
  }));
}
export function validateStoredAI(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.fingerprint) ||
    !["group", "write"].includes(String(v.kind)) ||
    !Number.isInteger(v.eventIndex) ||
    typeof v.model !== "string"
  )
    return false;
  try {
    if ("steps" in v) {
      if (!Array.isArray(v.steps) || v.steps.length > 120) return false;
      for (const step of v.steps) {
        if (typeof step.key !== "string" || typeof step.requestId !== "string")
          return false;
        if (step.result)
          validateResult(
            step.result,
            step.result.groups ? "group" : "write",
            step.result.groups?.flatMap((g: AIGroup) => g.photoIds) ?? [],
          );
      }
    } else
      validateResult(
        v,
        v.kind as "group" | "write",
        Array.isArray(v.groups)
          ? v.groups.flatMap((g: AIGroup) => g.photoIds)
          : [],
      );
    return true;
  } catch {
    return false;
  }
}

/** Only anonymous proximity labels leave the phone; precise coordinates remain local. */
export function localPlaceTags(
  ids: string[],
  media: Library["media"],
): Map<string, string> {
  const centers: { latitude: number; longitude: number }[] = [];
  const tags = new Map<string, string>();
  const rad = (n: number) => (n * Math.PI) / 180;
  for (const id of ids) {
    const m = media[id]?.photoMetadata;
    if (m?.latitude === undefined || m.longitude === undefined) continue;
    let index = centers.findIndex((c) => {
      const a =
        Math.sin(rad(m.latitude! - c.latitude) / 2) ** 2 +
        Math.cos(rad(c.latitude)) *
          Math.cos(rad(m.latitude!)) *
          Math.sin(rad(m.longitude! - c.longitude) / 2) ** 2;
      return (
        6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) <=
        250
      );
    });
    if (index < 0) {
      index = centers.length;
      centers.push({ latitude: m.latitude, longitude: m.longitude });
    }
    tags.set(id, `地点组${index + 1}`);
  }
  return tags;
}
