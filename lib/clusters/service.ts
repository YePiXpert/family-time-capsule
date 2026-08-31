import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  clusterSuggestion,
  type ClusterSuggestionRow,
} from "@/db/schema/clusters";
import { inboxItem } from "@/db/schema/inbox";
import { assertFamilyCapability } from "@/lib/authz/policy";
import { getAssetStorage } from "@/lib/assets/storage";
import { listInbox, type InboxEntry } from "@/lib/inbox/service";
import { mergeInboxEntries, defaultTitle } from "@/lib/memories/service";
import type { FamilyContext } from "@/lib/family/context";
import type { AssetRow } from "@/lib/assets/service";

/**
 * 本地无 AI 的收件箱分簇建议（M3-D）。
 *
 * - 不依赖任何外部 AI，AI 完全禁用时仍可运行；
 * - 只读 Asset 原件并在内存计算，不写入任何感知哈希；
 * - 所有建议均为 pending，用户显式接受后才调用已有 merge 流程。
 */

export type ClusterKind = "time_proximity" | "similar_media" | "live_photo_pair";

export type ClusterScanResult = {
  created: number;
  refreshed: number;
};

export type ResolveClusterResult =
  | { ok: true; eventId?: string }
  | { ok: false; error: string };

const TIME_WINDOW_MS = 45 * 60 * 1_000;
const LIVE_PHOTO_WINDOW_MS = 3 * 1_000;
const MAX_SCAN_ITEMS = 200;
const MAX_SCAN_IMAGES = 500;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SIMILAR_HASH_THRESHOLD = 5;

const IMAGE_HASH_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const LIVE_PHOTO_IMAGE_MIMES = new Set(["image/heic", "image/heif", "image/jpeg"]);
const LIVE_PHOTO_VIDEO_EXTENSIONS = new Set(["mov", "mp4"]);

function effectiveCapturedAt(asset: AssetRow): Date {
  return asset.capturedAt ?? asset.importedAt;
}

function formatMinutes(ms: number): number {
  return Math.round(ms / 60_000);
}

function normalizedBasename(filename: string): string {
  return filename.replace(/\.[^.]+$/u, "").toLowerCase();
}

function sortedIds(ids: string[]): string[] {
  return [...ids].sort();
}

function memberKey(kind: ClusterKind, ids: string[]): string {
  return `${kind}:${sortedIds(ids).join(",")}`;
}

/**
 * dHash：9×8 灰度图，每行 8 个位，共 64 位。
 * 64 位拆成两个 32 位半段（hi/lo），避免依赖 BigInt 字面量。
 * 感知哈希只在内存中计算，绝不写回 asset 行或文件。
 */
async function computeDhash(buffer: Buffer): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const { data } = await sharp(buffer)
      .greyscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let hi = 0;
    let lo = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = pixels[row * 9 + col];
        const right = pixels[row * 9 + col + 1];
        if (left > right) {
          const bit = row * 8 + col;
          if (bit < 32) lo |= 1 << bit;
          else hi |= 1 << (bit - 32);
        }
      }
    }
    return (
      (hi >>> 0).toString(16).padStart(8, "0") +
      (lo >>> 0).toString(16).padStart(8, "0")
    );
  } catch {
    return null;
  }
}

function hammingDistance(leftHex: string, rightHex: string): number {
  let count = 0;
  for (let i = 0; i < 16; i += 8) {
    const left = parseInt(leftHex.slice(i, i + 8), 16);
    const right = parseInt(rightHex.slice(i, i + 8), 16);
    let diff = (left ^ right) >>> 0;
    while (diff > 0) {
      count += diff & 1;
      diff = Math.floor(diff / 2);
    }
  }
  return count;
}

class UnionFind {
  readonly parent: Map<string, string> = new Map();

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) {
      const p = this.parent.get(root);
      if (!p) return root;
      root = p;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    this.parent.set(ra, rb);
  }

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
}

function isImageForHash(asset: AssetRow): boolean {
  return asset.type === "image" && IMAGE_HASH_MIMES.has(asset.mimeType) && asset.bytes <= MAX_IMAGE_BYTES;
}

function isLivePhotoImage(asset: AssetRow): boolean {
  return asset.type === "image" && LIVE_PHOTO_IMAGE_MIMES.has(asset.mimeType);
}

function isLivePhotoVideo(asset: AssetRow): boolean {
  if (asset.type !== "video") return false;
  const ext = asset.originalFilename.split(".").pop()?.toLowerCase() ?? "";
  return LIVE_PHOTO_VIDEO_EXTENSIONS.has(ext);
}

function itemImages(entries: InboxEntry[]): { entry: InboxEntry; asset: AssetRow }[] {
  const result: { entry: InboxEntry; asset: AssetRow }[] = [];
  let imageCount = 0;
  for (const entry of entries) {
    for (const asset of entry.assets) {
      if (isImageForHash(asset)) {
        result.push({ entry, asset });
        imageCount++;
        if (imageCount >= MAX_SCAN_IMAGES) return result;
      }
    }
  }
  return result;
}

function buildTimeProximityGroups(entries: InboxEntry[]): Map<string, InboxEntry[]> {
  const groups = new Map<string, InboxEntry[]>();
  const sorted = [...entries].sort((a, b) => {
    const ta = Math.min(...a.assets.map(effectiveCapturedAt).map((d) => d.getTime()));
    const tb = Math.min(...b.assets.map(effectiveCapturedAt).map((d) => d.getTime()));
    return ta - tb;
  });

  let window: InboxEntry[] = [];
  let windowStart = 0;

  for (const entry of sorted) {
    const entryTime = Math.min(...entry.assets.map(effectiveCapturedAt).map((d) => d.getTime()));
    if (window.length === 0) {
      window.push(entry);
      windowStart = entryTime;
      continue;
    }
    if (entryTime - windowStart <= TIME_WINDOW_MS) {
      window.push(entry);
    } else {
      if (window.length >= 2) {
        const key = memberKey("time_proximity", window.map((e) => e.item.id));
        groups.set(key, window);
      }
      window = [entry];
      windowStart = entryTime;
    }
  }
  if (window.length >= 2) {
    const key = memberKey("time_proximity", window.map((e) => e.item.id));
    groups.set(key, window);
  }
  return groups;
}

async function buildSimilarMediaGroups(
  entries: InboxEntry[],
): Promise<Map<string, InboxEntry[]>> {
  const groups = new Map<string, InboxEntry[]>();
  const storage = getAssetStorage();
  const imageAssets = itemImages(entries);

  const hashes = new Map<string, { entry: InboxEntry; asset: AssetRow; hash: string }>();
  for (const item of imageAssets) {
    try {
      const buffer = storage.read(item.asset.storageKey);
      const hash = await computeDhash(buffer);
      if (hash) {
        hashes.set(item.asset.id, { entry: item.entry, asset: item.asset, hash });
      }
    } catch {
      // 单张图片读取/哈希失败不影响整体扫描
    }
  }

  const uf = new UnionFind();
  const byEntry = [...hashes.values()].reduce(
    (map, item) => {
      const list = map.get(item.entry.item.id) ?? [];
      list.push(item);
      map.set(item.entry.item.id, list);
      return map;
    },
    new Map<string, { entry: InboxEntry; asset: AssetRow; hash: string }[]>(),
  );

  for (const items of byEntry.values()) {
    for (const item of items) uf.add(item.entry.item.id);
  }

  const entriesList = [...byEntry.entries()];
  for (let i = 0; i < entriesList.length; i++) {
    for (let j = i + 1; j < entriesList.length; j++) {
      const [idA, itemsA] = entriesList[i];
      const [idB, itemsB] = entriesList[j];
      let minDist = Infinity;
      for (const a of itemsA) {
        for (const b of itemsB) {
          const dist = hammingDistance(a.hash, b.hash);
          if (dist < minDist) minDist = dist;
        }
      }
      if (minDist <= SIMILAR_HASH_THRESHOLD) {
        uf.union(idA, idB);
      }
    }
  }

  const components = new Map<string, string[]>();
  for (const id of byEntry.keys()) {
    const root = uf.find(id);
    const list = components.get(root) ?? [];
    list.push(id);
    components.set(root, list);
  }

  for (const memberIds of components.values()) {
    if (memberIds.length < 2) continue;
    const members = entries.filter((e) => memberIds.includes(e.item.id));
    if (members.length < 2) continue;
    const key = memberKey("similar_media", memberIds);
    groups.set(key, members);
  }
  return groups;
}

function buildLivePhotoGroups(entries: InboxEntry[]): Map<string, InboxEntry[]> {
  const groups = new Map<string, InboxEntry[]>();
  const images: { entry: InboxEntry; asset: AssetRow }[] = [];
  const videos: { entry: InboxEntry; asset: AssetRow }[] = [];

  for (const entry of entries) {
    for (const asset of entry.assets) {
      if (isLivePhotoImage(asset)) images.push({ entry, asset });
      else if (isLivePhotoVideo(asset)) videos.push({ entry, asset });
    }
  }

  const uf = new UnionFind();
  for (const { entry } of images) uf.add(entry.item.id);
  for (const { entry } of videos) uf.add(entry.item.id);

  for (const img of images) {
    const imgBase = normalizedBasename(img.asset.originalFilename);
    const imgTime = effectiveCapturedAt(img.asset).getTime();
    for (const vid of videos) {
      if (img.entry.item.id === vid.entry.item.id) continue;
      const vidBase = normalizedBasename(vid.asset.originalFilename);
      if (imgBase !== vidBase || imgBase.length === 0) continue;
      const vidTime = effectiveCapturedAt(vid.asset).getTime();
      if (Math.abs(imgTime - vidTime) <= LIVE_PHOTO_WINDOW_MS) {
        uf.union(img.entry.item.id, vid.entry.item.id);
      }
    }
  }

  const components = new Map<string, string[]>();
  for (const id of uf.parent.keys()) {
    const root = uf.find(id);
    const list = components.get(root) ?? [];
    list.push(id);
    components.set(root, list);
  }

  for (const memberIds of components.values()) {
    if (memberIds.length < 2) continue;
    const members = entries.filter((e) => memberIds.includes(e.item.id));
    if (members.length < 2) continue;
    const key = memberKey("live_photo_pair", memberIds);
    groups.set(key, members);
  }
  return groups;
}

function buildReasonText(kind: ClusterKind, members: InboxEntry[]): string {
  if (kind === "time_proximity") {
    const times = members
      .flatMap((m) => m.assets.map(effectiveCapturedAt))
      .map((d) => d.getTime());
    const spanMs = Math.max(...times) - Math.min(...times);
    return `${members.length} 组素材拍摄于 ${formatMinutes(spanMs)} 分钟内`;
  }
  if (kind === "similar_media") {
    return "感知哈希距离 ≤5，画面高度相似";
  }
  // live_photo_pair
  const basenames = new Set(
    members
      .flatMap((m) => m.assets)
      .map((a) => normalizedBasename(a.originalFilename))
      .filter(Boolean),
  );
  const basename = [...basenames][0] ?? "同名文件";
  return `疑似 Live Photo：同名 ${basename}`;
}

/**
 * 加载本家庭全部分簇建议（含已处理墓碑）。
 * 已处理的 key 不再重建——用户说过「不是一件事」的组合不应该在每次扫描后复活。
 */
function loadExistingSuggestions(familyId: string): Map<string, ClusterSuggestionRow> {
  const rows = getDb()
    .select()
    .from(clusterSuggestion)
    .where(eq(clusterSuggestion.familyId, familyId))
    .all();
  const map = new Map<string, ClusterSuggestionRow>();
  for (const row of rows) {
    try {
      const ids = JSON.parse(row.inboxItemIdsJson) as string[];
      map.set(memberKey(row.kind as ClusterKind, ids), row);
    } catch {
      // 忽略损坏行
    }
  }
  return map;
}

/**
 * 扫描收件箱并生成/刷新本地分簇建议。
 *
 * 上限：200 个条目、500 张待哈希图片；>20 MiB 图片跳过。
 * 返回 { created, refreshed }；refreshed 表示已删除的陈旧建议数。
 */
export async function scanInboxClusters(
  context: FamilyContext,
): Promise<ClusterScanResult> {
  assertFamilyCapability(context.role, "inbox:review");
  const { familyId } = context;

  const entries = await listInbox(familyId, ["new", "needs_review", "processing"]);
  const assetOrBundle = entries.filter(
    (e) => e.item.kind === "asset" || e.item.kind === "bundle",
  );
  const cappedEntries = assetOrBundle.slice(0, MAX_SCAN_ITEMS);

  const existing = loadExistingSuggestions(familyId);
  const openItemIds = new Set(cappedEntries.map((e) => e.item.id));

  // 删除成员已离开收件箱的陈旧 pending 建议（accepted/dismissed 墓碑保留）
  let refreshed = 0;
  for (const [key, row] of existing) {
    if (row.status !== "pending") continue;
    try {
      const ids = JSON.parse(row.inboxItemIdsJson) as string[];
      if (ids.some((id) => !openItemIds.has(id))) {
        getDb()
          .delete(clusterSuggestion)
          .where(eq(clusterSuggestion.id, row.id))
          .run();
        existing.delete(key);
        refreshed++;
      }
    } catch {
      // 忽略
    }
  }

  const groups = new Map<string, { kind: ClusterKind; members: InboxEntry[] }>();

  for (const [key, members] of buildTimeProximityGroups(cappedEntries)) {
    groups.set(key, { kind: "time_proximity", members });
  }

  const similarGroups = await buildSimilarMediaGroups(cappedEntries);
  for (const [key, members] of similarGroups) {
    groups.set(key, { kind: "similar_media", members });
  }

  for (const [key, members] of buildLivePhotoGroups(cappedEntries)) {
    groups.set(key, { kind: "live_photo_pair", members });
  }

  let created = 0;
  const now = new Date();
  for (const { kind, members } of groups.values()) {
    const ids = sortedIds(members.map((m) => m.item.id));
    const key = memberKey(kind, ids);
    if (existing.has(key)) continue;

    getDb()
      .insert(clusterSuggestion)
      .values({
        id: randomUUID(),
        familyId,
        kind,
        inboxItemIdsJson: JSON.stringify(ids),
        reasonText: buildReasonText(kind, members),
        status: "pending",
        createdAt: now,
        resolvedAt: null,
        resolvedByUserId: null,
      })
      .run();
    created++;
  }

  return { created, refreshed };
}

export async function listPendingClusterSuggestions(
  familyId: string,
): Promise<ClusterSuggestionRow[]> {
  return getDb()
    .select()
    .from(clusterSuggestion)
    .where(
      and(
        eq(clusterSuggestion.familyId, familyId),
        eq(clusterSuggestion.status, "pending"),
      ),
    )
    .orderBy(clusterSuggestion.createdAt)
    .all();
}

export async function resolveClusterSuggestion(
  context: FamilyContext,
  suggestionId: string,
  action: "accept" | "dismiss",
  titleOverride?: string,
): Promise<ResolveClusterResult> {
  assertFamilyCapability(context.role, "inbox:review");
  const { familyId, userId } = context;

  const db = getDb();
  const row = db
    .select()
    .from(clusterSuggestion)
    .where(
      and(
        eq(clusterSuggestion.id, suggestionId),
        eq(clusterSuggestion.familyId, familyId),
      ),
    )
    .get();
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "pending") return { ok: false, error: "already_resolved" };

  let itemIds: string[];
  try {
    itemIds = JSON.parse(row.inboxItemIdsJson) as string[];
  } catch {
    return { ok: false, error: "invalid_members" };
  }

  const now = new Date();

  if (action === "dismiss") {
    db.update(clusterSuggestion)
      .set({
        status: "dismissed",
        resolvedAt: now,
        resolvedByUserId: userId,
      })
      .where(eq(clusterSuggestion.id, suggestionId))
      .run();
    return { ok: true };
  }

  // accept：验证成员仍开放且属于本家庭
  const openItems = await db
    .select({ id: inboxItem.id })
    .from(inboxItem)
    .where(
      and(
        eq(inboxItem.familyId, familyId),
        inArray(inboxItem.id, itemIds),
        inArray(inboxItem.status, ["new", "needs_review", "processing"]),
      ),
    )
    .all();
  if (openItems.length !== itemIds.length) {
    return { ok: false, error: "items_changed" };
  }

  const title =
    titleOverride?.trim() ||
    buildDefaultClusterTitle(
      (await listInbox(familyId, ["new", "needs_review", "processing"])).filter((e) =>
        itemIds.includes(e.item.id),
      ),
    );

  const mergeResult = await mergeInboxEntries(familyId, itemIds, { title });
  if (!mergeResult.ok) {
    return {
      ok: false,
      error:
        mergeResult.error === "no_child"
          ? "no_child"
          : mergeResult.error === "not_found"
            ? "items_changed"
            : "merge_failed",
    };
  }

  db.update(clusterSuggestion)
    .set({
      status: "accepted",
      resolvedAt: now,
      resolvedByUserId: userId,
    })
    .where(eq(clusterSuggestion.id, suggestionId))
    .run();

  return { ok: true, eventId: mergeResult.eventId };
}

function buildDefaultClusterTitle(members: InboxEntry[]): string {
  if (members.length === 0) return "一段记忆";
  const firstAsset = members[0].assets[0];
  if (firstAsset) {
    return firstAsset.originalFilename.replace(/\.[^.]+$/u, "");
  }
  return defaultTitle(members[0]);
}
