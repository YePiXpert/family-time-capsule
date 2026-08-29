import { getApiFamilyContext } from "@/lib/family/context";
import { getAssetByIdUnchecked } from "@/lib/assets/ingest";
import { getAssetStorage } from "@/lib/assets/storage";

/**
 * GET /api/media/[assetId] —— 唯一合法的媒体读取入口（Issue #005）。
 * /data/** 永不静态公开；必须携带会话，且 Asset 必须属于该会话的家庭，
 * 否则一律 404（不向跨家庭访问者暴露资源是否存在）。
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  const context = await getApiFamilyContext(request.headers);
  if (!context) return new Response("Unauthorized", { status: 401 });

  const row = await getAssetByIdUnchecked(assetId);
  if (!row || row.familyId !== context.familyId) {
    return new Response("Not Found", { status: 404 });
  }

  const storage = getAssetStorage();
  if (!storage.exists(row.storageKey)) {
    return new Response("Not Found", { status: 404 });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const displayFilename = row.originalFilename.replace(/[\r\n"]/g, "_");
  const headers = new Headers({
    "Content-Type": row.mimeType,
    "Content-Length": String(row.bytes),
    // 私人媒体：禁止中间缓存与 MIME 嗅探
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(displayFilename)}`,
  });

  return new Response(storage.createWebStream(row.storageKey), { headers });
}
