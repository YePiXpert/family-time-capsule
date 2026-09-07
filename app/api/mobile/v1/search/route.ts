import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { mobileJson } from "@/lib/mobile/http";
import { getMobileSearch } from "@/lib/mobile/product";

const MEDIA_TYPES = new Set(["image", "video", "audio", "document"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export async function GET(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const rawLimit = Number(url.searchParams.get("limit") ?? "25");
  const limit = Number.isSafeInteger(rawLimit) ? rawLimit : 25;
  // 与在线搜索一致的筛选语义（FIND-2）：人物/日期范围/媒体类型。
  const personId = url.searchParams.get("personId");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const mediaType = url.searchParams.get("mediaType");
  return mobileJson(query
    ? getMobileSearch(authorization.context, query, url.searchParams.get("cursor"), limit, {
      personId: personId && /^[\w-]{1,128}$/u.test(personId) ? personId : undefined,
      dateFrom: dateFrom && DATE.test(dateFrom) ? dateFrom : undefined,
      dateTo: dateTo && DATE.test(dateTo) ? dateTo : undefined,
      mediaType: mediaType && MEDIA_TYPES.has(mediaType) ? mediaType as "image" | "video" | "audio" | "document" : undefined,
    })
    : { items: [], nextCursor: null });
}
