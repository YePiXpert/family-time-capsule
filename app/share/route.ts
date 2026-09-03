import { getApiFamilyContext } from "@/lib/family/context";
import { hasFamilyCapability } from "@/lib/authz/policy";
import { ingestImage, ingestMedia } from "@/lib/assets/ingest";
import { MAX_VIDEO_BYTES } from "@/lib/assets/validation";
import { createInboxItemForAsset, createTextInboxItem } from "@/lib/inbox/service";
import { isSameOrigin, requestBodySizeError } from "@/lib/security/origin";

/**
 * POST /share —— PWA Share Target 的原生 multipart 入口（M6）。
 * 系统「分享到」菜单直接 POST 到这里；同源 + 会话 + capture:create 校验后
 * 把照片/视频/音频/文字/链接收进收件箱。
 */
/** GET /share：手动打开时引导到收件箱（share_target 的入口是 POST）。 */
export async function GET(request: Request) {
  return Response.redirect(new URL("/inbox", request.url), 303);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const context = await getApiFamilyContext(request.headers);
  if (!context) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasFamilyCapability(context.role, "capture:create")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
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

  let items = 0;
  let discarded = 0;

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of files) {
    const mime = file.type || "application/octet-stream";
    const isAudio = mime.startsWith("audio/");
    const isVideo = mime.startsWith("video/");
    const isImage = mime.startsWith("image/");
    if (!isAudio && !isVideo && !isImage) {
      discarded++;
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = isImage
      ? await ingestImage({
          familyId: context.familyId,
          createdByUserId: context.userId,
          filename: file.name || "分享的图片",
          declaredMime: mime,
          buffer,
          clientLastModifiedMs: file.lastModified || null,
        })
      : await ingestMedia({
          familyId: context.familyId,
          createdByUserId: context.userId,
          kind: isAudio ? "audio" : "video",
          filename: file.name || "分享的媒体",
          declaredMime: mime,
          buffer,
          clientLastModifiedMs: file.lastModified || null,
        });
    if (stored.status === "rejected") {
      discarded++;
      continue;
    }
    const asset = stored.status === "stored" ? stored.asset : stored.existing;
    await createInboxItemForAsset(context.familyId, asset);
    items++;
  }

  const title = String(form.get("title") ?? "").trim();
  const text = String(form.get("text") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  const combined = [title, text, url].filter(Boolean).join("\n");
  if (combined.length > 0) {
    await createTextInboxItem(context.familyId, combined.slice(0, 10_000));
    items++;
  }

  const target = new URL("/inbox", request.url);
  target.searchParams.set("shared", String(items));
  if (discarded > 0) target.searchParams.set("skipped", String(discarded));
  return Response.redirect(target, 303);
}
