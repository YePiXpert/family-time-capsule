/**
 * 同源校验：自建状态变更型 API（上传等）的 CSRF 纵深防御。
 * better-auth 端点有自身 Origin 校验；这里覆盖我们自己的 POST 路由。
 * （Cookie SameSite=Lax 是第一层，本检查兜住非常规客户端。）
 */

export function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // 同源 GET/fetch 有时不带 Origin；SameSite 已兜底
  try {
    const originUrl = new URL(origin);
    // Next/反向代理与 Server Action 使用相同优先级：入口代理应覆盖而不是
    // 追加 x-forwarded-host；逗号链只接受最靠近应用的第一个值。
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",", 1)[0]
      ?.trim();
    const host = forwardedHost || request.headers.get("host");
    return originUrl.host === host;
  } catch {
    return false;
  }
}

export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * `request.formData()` materializes the body, so accept it only when the HTTP
 * transport has committed to a finite Content-Length. Real browser multipart
 * requests set this header; rejecting chunked/ambiguous bodies keeps hostile
 * clients from bypassing the documented in-memory ceiling.
 */
export function requestBodySizeError(
  request: Request,
  maxPayloadBytes: number,
): "length_required" | "too_large" | null {
  const raw = request.headers.get("content-length");
  if (!raw || !/^\d+$/u.test(raw)) return "length_required";
  const bytes = Number(raw);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return "length_required";
  return bytes > maxPayloadBytes + MULTIPART_OVERHEAD_BYTES
    ? "too_large"
    : null;
}
