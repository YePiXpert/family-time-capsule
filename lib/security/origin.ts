/**
 * 同源校验：自建状态变更型 API（上传等）的 CSRF 纵深防御。
 * better-auth 端点有自身 Origin 校验；这里覆盖我们自己的 POST 路由。
 * （Cookie SameSite=Lax 是第一层，本检查兜住非常规客户端。）
 */

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // 同源 GET/fetch 有时不带 Origin；SameSite 已兜底
  try {
    const originUrl = new URL(origin);
    const host = request.headers.get("host");
    return originUrl.host === host;
  } catch {
    return false;
  }
}
