/** On-demand place naming for photo coordinates. */

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
