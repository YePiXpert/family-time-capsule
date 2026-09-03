import { MAX_VIDEO_BYTES } from "@/lib/assets/validation";
import { submitGuestMedia } from "@/lib/oral-history/service";
import { isSameOrigin, requestBodySizeError } from "@/lib/security/origin";

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "这个链接这一小时内的提交已满，请稍后再试。",
  unsupported_media: "只支持图片、音频或视频文件。",
  too_large: "文件超过大小限制。",
  expired: "链接已过期。",
  closed: "链接已关闭。",
  not_found: "链接无效。",
};

/**
 * Public bearer-token upload endpoint. Unlike a Server Action, this route can
 * report byte progress and enforce Content-Length before materializing FormData.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const sizeError = requestBodySizeError(request, MAX_VIDEO_BYTES);
  if (sizeError) {
    return Response.json(
      {
        error: sizeError,
        message:
          sizeError === "too_large"
            ? "文件超过 500MB 总请求上限。"
            : "无法确认上传大小，请使用页面里的文件选择器重试。",
      },
      { status: sizeError === "too_large" ? 413 : 411 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid_form", message: "上传内容无法读取。" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "file_required", message: "请选择要上传的文件。" }, { status: 400 });
  }
  const lastModifiedRaw = form.get("lastModified");
  const clientLastModifiedMs =
    typeof lastModifiedRaw === "string" && /^\d+$/u.test(lastModifiedRaw)
      ? Number(lastModifiedRaw)
      : null;
  const { token } = await params;
  const result = await submitGuestMedia(token, {
    filename: file.name || "提交的媒体",
    declaredMime: file.type || "application/octet-stream",
    buffer: Buffer.from(await file.arrayBuffer()),
    clientLastModifiedMs,
  });
  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        message: ERROR_MESSAGES[result.error] ?? "上传失败，请检查文件格式。",
      },
      { status: result.error === "rate_limited" ? 429 : 400 },
    );
  }
  return Response.json({ success: true }, { status: 201 });
}
