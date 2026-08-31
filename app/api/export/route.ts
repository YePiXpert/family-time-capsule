import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { buildFamilyExport, ExportVerificationError } from "@/lib/export/service";

/**
 * GET /api/export —— 完整 ZIP 导出（Issue #014）。
 * 需要会话 + 家庭绑定；导出前会重新校验所有原件 SHA-256，
 * 不符则 409 明确失败（绝不生成看似成功的备份）。
 */
export async function GET(request: Request) {
  const authorization = await authorizeApiFamilyRequest(
    request.headers,
    "archive:export",
  );
  if (!authorization.ok) {
    return new Response(
      authorization.status === 401 ? "Unauthorized" : "Forbidden",
      { status: authorization.status },
    );
  }
  const { context } = authorization;

  let result;
  try {
    result = await buildFamilyExport(context.familyId, {
      actorUserId: context.userId,
    });
  } catch (err) {
    if (err instanceof ExportVerificationError) {
      return Response.json(
        {
          error: "checksum_mismatch",
          detail: err.detail,
          message: "导出中止：有原件与数据库记录的 SHA-256 不一致，请先核查存储。",
        },
        { status: 409 },
      );
    }
    throw err;
  }

  const stream = Readable.toWeb(
    createReadStream(result.filePath),
  ) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(result.bytes),
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
