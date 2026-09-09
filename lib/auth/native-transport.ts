import "server-only";
import { getAuth } from "./auth";
import { asRecord, mobileJson, mobileRequestError, readMobileJson } from "@/lib/mobile/http";

/** Transport only: Better Auth still owns challenge signing, expiry, consumption,
 * TOTP/recovery-code checks, account lockout and HTTP rate limiting. Native apps
 * hold the signed challenge in memory instead of sharing a platform cookie jar. */
export async function handleNativeAuthRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const signingIn = path === "/api/auth/sign-in/email";
  const verifying = ["/api/auth/two-factor/verify-totp", "/api/auth/two-factor/verify-backup-code"].includes(path);
  if (request.method !== "POST" || (!signingIn && !verifying)) return mobileJson({ error: "invalid_input" }, { status: 400 });
  const auth = getAuth(), context = await auth.$context;
  if (!context.baseURL) return mobileJson({ error: "auth_origin_unconfigured" }, { status: 503 });
  if (request.headers.get("origin") !== new URL(context.baseURL).origin) return mobileJson({ error: "forbidden" }, { status: 403 });
  const cookieName = context.createAuthCookie("two_factor").name;
  let body: Record<string, unknown>;
  try { body = asRecord(await readMobileJson(request, 4096)); } catch (error) { return mobileRequestError(error); }
  const headers = new Headers(request.headers);
  // A remembered browser session or trust-device cookie must never select a
  // different account or skip the second factor of this native login.
  headers.delete("cookie"); headers.delete("authorization"); headers.delete("content-length");
  headers.delete("x-ftc-two-factor-challenge");
  if (verifying) {
    const challenge = request.headers.get("x-ftc-two-factor-challenge");
    if (!challenge || !/^[A-Za-z0-9%._~+/=-]{1,1024}$/u.test(challenge)) return mobileJson({ error: "invalid_challenge" }, { status: 400 });
    headers.set("cookie", `${cookieName}=${challenge}`);
    body = { code: body.code, trustDevice: false };
  }
  const response = await auth.handler(new Request(request.url, { method: "POST", headers, body: JSON.stringify(body) }));
  const result = await response.clone().json().catch(() => null) as { twoFactorRedirect?: boolean } | null;
  const outgoing = new Headers(response.headers);
  outgoing.delete("set-cookie");
  outgoing.set("cache-control", "private, no-store");
  if (result?.twoFactorRedirect === true) {
    outgoing.delete("set-auth-token");
    const pair = response.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]!).find(cookie => cookie.startsWith(`${cookieName}=`));
    if (!pair) return mobileJson({ error: "challenge_unavailable" }, { status: 503 });
    outgoing.set("x-ftc-two-factor-challenge", pair.slice(cookieName.length + 1));
  }
  return new Response(response.body, { status: response.status, headers: outgoing });
}
