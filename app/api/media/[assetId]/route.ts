import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { getAssetByIdUnchecked } from "@/lib/assets/ingest";
import { getAssetStorage } from "@/lib/assets/storage";

/**
 * GET /api/media/[assetId] —— 唯一合法的媒体读取入口（Issue #005/#011）。
 * /data/** 永不静态公开；必须携带会话，且 Asset 必须属于该会话的家庭，
 * 否则一律 404（不向跨家庭访问者暴露资源是否存在）。
 * 音频/视频回放需要 HTTP Range（seek/流式播放），图片无需 Range 也不受影响。
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  const authorization = await authorizeApiFamilyRequest(
    request.headers,
    "archive:view",
  );
  if (!authorization.ok) {
    return new Response(
      authorization.status === 401 ? "Unauthorized" : "Forbidden",
      { status: authorization.status },
    );
  }
  const { context } = authorization;

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
  const baseHeaders: Record<string, string> = {
    "Content-Type": row.mimeType,
    // 私人媒体：禁止中间缓存与 MIME 嗅探
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(displayFilename)}`,
  };

  const absPath = storage.resolvePath(row.storageKey);
  const rangeHeader = request.headers.get("range");
  const match = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null;

  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), row.bytes - 1) : row.bytes - 1;
    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start > end ||
      start >= row.bytes
    ) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${row.bytes}` },
      });
    }
    const stream = Readable.toWeb(
      createReadStream(absPath, { start, end }),
    ) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${row.bytes}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const stream = storage.createWebStream(row.storageKey);
  return new Response(stream, {
    headers: { ...baseHeaders, "Content-Length": String(row.bytes), "Accept-Ranges": "bytes" },
  });
}
