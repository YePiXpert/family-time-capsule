import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { MAX_VIDEO_BYTES } from "@/lib/assets/validation";
import { ingestMedia } from "@/lib/assets/ingest";
import { sha256Of } from "@/lib/assets/service";
import {
  createInboxItemForAsset,
  createInboxItemForAssetIdempotent,
  getInboxEntry,
} from "@/lib/inbox/service";
import { isSameOrigin, requestBodySizeError } from "@/lib/security/origin";

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
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

  // M7：formData() 会缓冲整个请求体——解析前先按 Content-Length 拒绝超限，
  // 避免为注定失败的请求付出整文件内存
  const sizeError = requestBodySizeError(request, MAX_VIDEO_BYTES);
  if (sizeError) {
    return Response.json(
      { error: sizeError },
      { status: sizeError === "too_large" ? 413 : 411 },
    );
  }

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
  const filenameField = form.get("filename");
  const filename =
    typeof filenameField === "string" && filenameField.trim()
      ? filenameField.trim().slice(0, 200)
      : file.name;
  const captureIdField = form.get("captureId");
  const captureId =
    typeof captureIdField === "string" && UUID_PATTERN.test(captureIdField)
      ? captureIdField
      : null;
  if (captureIdField !== null && captureId === null) {
    return Response.json({ error: "invalid_capture_id" }, { status: 400 });
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
  const buffer = Buffer.from(await file.arrayBuffer());
  if (captureId) {
    const existingCapture = await getInboxEntry(context.familyId, captureId);
    if (existingCapture) {
      const existingAsset = existingCapture.assets[0];
      if (
        existingCapture.item.kind !== "asset" ||
        existingCapture.assets.length !== 1 ||
        existingAsset?.sha256 !== sha256Of(buffer)
      ) {
        return Response.json({ error: "capture_id_conflict" }, { status: 409 });
      }
      return Response.json(
        {
          status: "duplicate",
          existingAssetId: existingAsset.id,
          existingFilename: existingAsset.originalFilename,
          message: "设备记录已接收，未重复保存。",
        },
        { status: 200 },
      );
    }
  }
  const result = await ingestMedia({
    familyId: context.familyId,
    createdByUserId: context.userId,
    kind,
    filename,
    declaredMime: file.type,
    buffer,
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
      if (captureId) {
        const inbox = createInboxItemForAssetIdempotent(
          context.familyId,
          result.existing,
          captureId,
        );
        if (inbox.status === "conflict") {
          return Response.json({ error: "capture_id_conflict" }, { status: 409 });
        }
      }
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
      if (captureId) {
        const inbox = createInboxItemForAssetIdempotent(
          context.familyId,
          result.asset,
          captureId,
        );
        if (inbox.status === "conflict") {
          return Response.json({ error: "capture_id_conflict" }, { status: 409 });
        }
      } else {
        await createInboxItemForAsset(context.familyId, result.asset);
      }
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
