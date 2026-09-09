import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { user, session, verification } from "@/db/schema/auth";
import { getAuth } from "@/lib/auth/auth";
import { performSetup } from "@/lib/auth/setup";
import { POST } from "@/app/api/auth/[...all]/route";
import { secretFromOtpauthUri, totpCode } from "../e2e/helpers/totp";
import { signIn, TwoFactorRequiredError, verifyTwoFactor } from "../../mobile/src/api/client";

process.env.AUTH_SECRET = "native-two-factor-synthetic-secret-0123456789";
process.env.BETTER_AUTH_URL = "http://localhost:3197";
process.env.INITIAL_SETUP_TOKEN = "native-two-factor-setup";
process.env.AUTH_SIGNIN_RATE_LIMIT_MAX = "100";
const password = "synthetic-native-password";
let secret: string, recovery: string[], ownerId: string;
let server: Server;
let origin = "http://localhost:3197";
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => POST(new Request(`${origin}/api/auth/${path}`, {
  method: "POST", headers: { "content-type": "application/json", origin, "x-ftc-native-auth": "1", ...headers }, body: JSON.stringify(body),
}));
const start = () => post("sign-in/email", { email: "native-factor@example.invalid", password });
const verify = (challenge: string, code: string, method = "totp", headers: Record<string,string> = {}) => post(`two-factor/verify-${method === "totp" ? "totp" : "backup-code"}`, { code }, { "x-ftc-two-factor-challenge": challenge, ...headers });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const headers = new Headers(); for (const [key,value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const response = await POST(new Request(`${origin}${req.url}`, { method: "POST", headers, body: Buffer.concat(chunks) }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No test listener");
  origin = `http://127.0.0.1:${address.port}`;
  process.env.BETTER_AUTH_URL = origin;
  expect((await performSetup({ token: "native-two-factor-setup", displayName: "合成管理员", email: "native-factor@example.invalid", password })).ok).toBe(true);
  const signed = await getAuth().api.signInEmail({ body: { email: "native-factor@example.invalid", password } });
  ownerId = signed.user.id;
  const headers = new Headers({ authorization: `Bearer ${signed.token}` });
  const enabled = await getAuth().api.enableTwoFactor({ headers, body: { password } });
  if (enabled.method !== "totp") throw new Error("TOTP not enabled");
  secret = secretFromOtpauthUri(enabled.totpURI); recovery = enabled.backupCodes;
  await getAuth().api.verifyTOTP({ headers, body: { code: totpCode(secret) } });
  getDb().delete(session).run();
});
afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });

it("native password login yields a challenge without a session; TOTP completes it once", async () => {
  const first = await start();
  expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
  const challenge = first.headers.get("x-ftc-two-factor-challenge");
  expect(challenge).toBeTruthy();
  expect(first.headers.get("set-cookie")).toBeNull();
  expect(first.headers.get("set-auth-token")).toBeNull();
  expect(getDb().select().from(session).all()).toHaveLength(0);
  const wrong = await verify(challenge!, "not-a-code"); expect(wrong.ok).toBe(false);
  const good = await verify(challenge!, totpCode(secret));
  expect(good.status).toBe(200); expect(good.headers.get("set-cookie")).toBeNull();
  const body = await good.json(); expect(body.token).toBeTruthy();
  expect((await getAuth().api.getSession({ headers: new Headers({ authorization: `Bearer ${body.token}` }) }))?.user.id).toBe(ownerId);
  expect((await verify(challenge!, totpCode(secret))).ok).toBe(false);
});

it("backup codes work once, and an unrelated authenticated session cannot bypass a missing challenge", async () => {
  const first = await start(); const challenge = first.headers.get("x-ftc-two-factor-challenge")!;
  expect(challenge).toBeTruthy();
  const valid = await verify(challenge, recovery[0]!, "backup"); expect(valid.status).toBe(200);
  const body = await valid.json();
  const next = (await start()).headers.get("x-ftc-two-factor-challenge")!;
  expect((await verify(next, recovery[0]!, "backup")).ok).toBe(false);
  expect((await verify("", totpCode(secret), "totp", { authorization: `Bearer ${body.token}` })).ok).toBe(false);
  expect((await verify("cookie; injected=value", totpCode(secret))).status).toBe(400);
});

it("current mobile DTO completes TOTP and recovery login over real loopback HTTP", async () => {
  async function challenge() {
    try { await signIn(origin, "native-factor@example.invalid", password); throw new Error("Expected second factor"); }
    catch (error) { if (!(error instanceof TwoFactorRequiredError)) throw error; return error.pending; }
  }
  const pending = await challenge();
  expect(pending.serverUrl).toBe(origin);
  const credentials = await verifyTwoFactor(pending, totpCode(secret), "totp");
  expect((await getAuth().api.getSession({ headers: new Headers({ authorization: `Bearer ${credentials.token}` }) }))?.user.id).toBe(ownerId);
  const recovered = await verifyTwoFactor(await challenge(), recovery[2]!, "backup");
  expect(recovered.token).toBeTruthy();
});

it("expired challenges and foreign origins fail before a session is created", async () => {
  const challenge = (await start()).headers.get("x-ftc-two-factor-challenge")!;
  getDb().update(verification).set({ expiresAt: new Date(0) }).run();
  const before = getDb().select().from(session).all().length;
  expect((await verify(challenge, totpCode(secret))).ok).toBe(false);
  expect((await post("sign-in/email", { email: "native-factor@example.invalid", password }, { origin: "https://other.example" })).status).toBe(403);
  expect(getDb().select().from(session).all()).toHaveLength(before);
});

it("concurrent second-factor submissions create only one session", async () => {
  const challenge = (await start()).headers.get("x-ftc-two-factor-challenge")!;
  const before = getDb().select().from(session).all().length;
  const responses = await Promise.all([verify(challenge, totpCode(secret)), verify(challenge, totpCode(secret))]);
  expect(responses.filter(response => response.ok)).toHaveLength(1);
  expect(getDb().select().from(session).all()).toHaveLength(before + 1);
});

it("native requests still pass the library HTTP verification rate limit", async () => {
  const statuses: number[] = [];
  for (let n = 0; n < 9; n++) statuses.push((await verify("invalid-signed-challenge", "000000", "totp", { "x-forwarded-for": "192.0.2.91" })).status);
  expect(statuses.slice(0,8).every(status => status === 401)).toBe(true);
  expect(statuses[8]).toBe(429);
});

it("a challenge cannot create a session after the account is disabled", async () => {
  const challenge = (await start()).headers.get("x-ftc-two-factor-challenge")!;
  expect(challenge).toBeTruthy();
  getDb().update(user).set({ disabledAt: new Date() }).where(eq(user.id, ownerId)).run();
  const before = getDb().select().from(session).all().length;
  expect((await verify(challenge, recovery[1]!, "backup")).ok).toBe(false);
  expect(getDb().select().from(session).all()).toHaveLength(before);
});
