/**
 * A short-lived abuse-control subject. The raw value is immediately one-way
 * hashed by consumeSecurityRateLimit and is never written to application data.
 * The deployment proxy must replace (not append untrusted input to) X-Forwarded-For.
 */
export function anonymousRequestSubject(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const address = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  const agent = headers.get("user-agent")?.slice(0, 160) || "unknown";
  return `${address}\0${agent}`;
}
