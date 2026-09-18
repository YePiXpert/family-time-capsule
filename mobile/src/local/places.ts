/** On-demand place naming for photo coordinates. */
import type { LocalMedia } from "./model";

/** 现有地点文本是否只是裸坐标（来自拍摄信息自动填入）。 */
export function looksLikeCoordinates(text: string): boolean {
  return /^-?\d{1,3}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?$/.test(text.trim());
}

export type PlaceCandidate = {
  name?: string | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  formattedAddress?: string | null;
};

/** 优先具体地标，其次市/区/街道的组合；残缺时退回国家或原始坐标。 */
export function placeLabel(
  candidate: PlaceCandidate | undefined,
  fallback: string,
): string {
  if (!candidate) return fallback;
  const name = candidate.name?.trim();
  if (name) return name;
  const area = [candidate.city, candidate.district, candidate.street]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join("");
  if (area) return area;
  const region = [candidate.region, candidate.country]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" · ");
  return region || candidate.formattedAddress?.trim() || fallback;
}

export type GeoPoint = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6371000;
export const PLACE_CLUSTER_RADIUS_M = 250;

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (n: number) => (n * Math.PI) / 180;
  const h =
    Math.sin(rad(a.latitude - b.latitude) / 2) ** 2 +
    Math.cos(rad(b.latitude)) *
      Math.cos(rad(a.latitude)) *
      Math.sin(rad(a.longitude - b.longitude) / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export type PlaceCluster = {
  center: GeoPoint;
  mediaIds: string[];
  firstAt: string;
  lastAt: string;
};

/**
 * 250 米坐标聚类：按传入顺序归入第一个够近的组，中心取组内第一张的坐标；
 * 首末日期取组内照片拍摄时间的最值（无拍摄时间的照片只计数）。
 */
export function clusterPlaces(media: LocalMedia[]): PlaceCluster[] {
  const clusters: PlaceCluster[] = [];
  for (const m of media) {
    const meta = m.photoMetadata;
    if (meta?.latitude === undefined || meta.longitude === undefined) continue;
    const point = { latitude: meta.latitude, longitude: meta.longitude };
    let cluster = clusters.find(
      (c) => distanceMeters(c.center, point) <= PLACE_CLUSTER_RADIUS_M,
    );
    if (!cluster) {
      cluster = { center: point, mediaIds: [], firstAt: "", lastAt: "" };
      clusters.push(cluster);
    }
    cluster.mediaIds.push(m.id);
    const at = meta.capturedAt;
    if (at) {
      if (!cluster.firstAt || at < cluster.firstAt) cluster.firstAt = at;
      if (at > cluster.lastAt) cluster.lastAt = at;
    }
  }
  return clusters;
}
