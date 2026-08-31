import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { ingestImage } from "@/lib/assets/ingest";
import { createInboxItemForAsset } from "@/lib/inbox/service";
import { isSameOrigin } from "@/lib/security/origin";

/**
 * POST /api/upload/image —— 图片上传入口（手机相册 / 电脑文件均可）。
 * multipart/form-data: file(必填)、lastModified(可选，File.lastModified 毫秒)。
 */

const MESSAGES: Record<string, string> = {
  too_large: "文件超过 50MB 限制。",
  mime_not_allowed: "不支持的图片类型。",
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

  const lastModifiedRaw = Number(form.get("lastModified"));
  const result = await ingestImage({
    familyId: context.familyId,
    createdByUserId: context.userId,
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
      // 新内容一律先进收件箱（#007），不直接进 Timeline
      await createInboxItemForAsset(context.familyId, result.asset);
      return Response.json(
        {
          status: "stored",
          assetId: result.asset.id,
          capturedAt: result.asset.capturedAt?.toISOString() ?? null,
          importedAt: result.asset.importedAt.toISOString(),
          timeSource: result.asset.timeSource,
          width: result.asset.width,
          height: result.asset.height,
        },
        { status: 201 },
      );
  }
}
