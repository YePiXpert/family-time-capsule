import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { ingestMedia } from "@/lib/assets/ingest";
import { createInboxItemForAsset } from "@/lib/inbox/service";
import { isSameOrigin } from "@/lib/security/origin";

/**
 * POST /api/upload/media —— 音频/视频上传（后续上传已有文件；不要求 App 内录制）。
 * multipart/form-data: file(必填)、lastModified(可选)。
 * kind 由声明的 MIME 家族决定（audio/* 或 video/*）。
 */

const MESSAGES: Record<string, string> = {
  too_large: "文件超过大小限制（音频 200MB / 视频 500MB）。",
  mime_not_allowed: "不支持的媒体类型。",
  content_mismatch: "文件内容与声明的类型不符。",
  empty: "文件为空。",
};

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const authorization = await authorizeApiFamilyRequest(
    request.headers,
    "capture:create",
  );
  if (!authorization.ok) {
    return Response.json(
      { error: authorization.error },
      { status: authorization.status },
    );
  }
  const { context } = authorization;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid_form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file_required" }, { status: 400 });
  }

  const kind = file.type.startsWith("audio/")
    ? ("audio" as const)
    : file.type.startsWith("video/")
      ? ("video" as const)
      : null;
  if (!kind) {
    return Response.json(
      { error: "mime_not_allowed", message: MESSAGES.mime_not_allowed },
      { status: 415 },
    );
  }

  const lastModifiedRaw = Number(form.get("lastModified"));
  const result = await ingestMedia({
    familyId: context.familyId,
    createdByUserId: context.userId,
    kind,
    filename: file.name,
    declaredMime: file.type,
    buffer: Buffer.from(await file.arrayBuffer()),
    clientLastModifiedMs: Number.isFinite(lastModifiedRaw) && lastModifiedRaw > 0
      ? lastModifiedRaw
      : null,
  });

  switch (result.status) {
    case "rejected":
      return Response.json(
        { error: result.error, message: MESSAGES[result.error] },
        { status: 415 },
      );
    case "duplicate":
      return Response.json(
        {
          status: "duplicate",
          existingAssetId: result.existing.id,
          existingFilename: result.existing.originalFilename,
          message: "已存在相同原件（SHA-256 一致），未重复保存。",
        },
        { status: 200 },
      );
    case "stored":
      await createInboxItemForAsset(context.familyId, result.asset);
      return Response.json(
        {
          status: "stored",
          assetId: result.asset.id,
          type: result.asset.type,
          durationMs: result.asset.durationMs,
          capturedAt: result.asset.capturedAt?.toISOString() ?? null,
          timeSource: result.asset.timeSource,
        },
        { status: 201 },
      );
  }
}
