import "server-only";

import { randomUUID } from "node:crypto";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type Base64URLString,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { passkey, user as userTable } from "@/db/schema/auth";
import { recordAudit } from "@/lib/audit/service";

/**
 * WebAuthn 通行密钥（ID-6；白皮书 §12「成熟认证组件」）。
 *
 * better-auth 1.7 未内置 passkey 插件，这里以官方插件协议实现同等端点：
 * - 注册/移除/列表：需要已登录会话（sessionMiddleware，cookie 与原生 bearer 均可）；
 * - 登录：公开端点，usernameless（可发现凭据），验证断言后经
 *   internalAdapter.createSession 建立与密码登录完全同构的数据库会话
 *   （因此同样经过 databaseHooks.session.create.before 的停用账号门禁），
 *   并同时下发 HttpOnly cookie 与 set-auth-token（原生客户端）。
 * - challenge 只存 verification 表（2 分钟过期、单次消费），不新增状态表；
 * - rpID/origin 取自 BETTER_AUTH_URL（部署必配），不接受请求头伪造；
 * - 断言验证强制 counter 前进与 rpID 匹配，防重放与跨源凭证混淆。
 */

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const REGISTER_CHALLENGE_PREFIX = "passkey:register";
const AUTH_CHALLENGE_PREFIX = "passkey:auth";

type RpContext = { rpId: string; origin: string };

/** better-auth 内部适配器的最小面（createSession 直返会话行）。 */
type InternalAdapter = {
  createVerificationValue: (input: {
    value: string;
    identifier: string;
    expiresAt: Date;
  }) => Promise<unknown>;
  consumeVerificationValue: (
    identifier: string,
  ) => Promise<{ value: string } | null>;
  createSession: (userId: string) => Promise<{
    id: string;
    token: string;
    userId: string;
  }>;
};

function adapterOf(context: { internalAdapter: unknown }): InternalAdapter {
  return context.internalAdapter as InternalAdapter;
}

function resolveRpContext(context: {
  baseURL?: string;
  request?: Request | null;
}): RpContext | null {
  const candidates: string[] = [];
  if (context.baseURL && /^https?:\/\//u.test(context.baseURL)) {
    candidates.push(context.baseURL);
  }
  const originHeader = context.request?.headers.get("origin");
  if (originHeader) candidates.push(originHeader);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const isSecure = url.protocol === "https:";
      const isLocalHost =
        url.hostname === "localhost" || url.hostname === "127.0.0.1";
      // WebAuthn 仅在安全上下文可用；本地开发例外。
      if (!isSecure && !isLocalHost) continue;
      return { rpId: url.hostname, origin: url.origin };
    } catch {
      // 非法 URL，跳过
    }
  }
  return null;
}

function requireRpContext(context: {
  baseURL?: string;
  request?: Request | null;
}): RpContext {
  const rp = resolveRpContext(context);
  if (!rp) {
    throw new APIError("BAD_REQUEST", {
      message:
        "通行密钥需要 HTTPS 访问地址（本地 localhost 除外）。请检查 BETTER_AUTH_URL 配置。",
    });
  }
  return rp;
}

function publicKeyToStorage(key: Uint8Array): string {
  return Buffer.from(key).toString("base64url");
}

function publicKeyFromStorage(key: string): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.from(key, "base64url");
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy;
}

function hasResponseShape(value: unknown): value is RegistrationResponseJSON {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { rawId?: unknown }).rawId === "string" &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { response?: unknown }).response === "object" &&
    (value as { response?: unknown }).response !== null
  );
}

function isAuthenticationResponse(
  value: unknown,
): value is AuthenticationResponseJSON {
  return hasResponseShape(value);
}

function pickString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function bodyOf(ctx: { body?: unknown }): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

export function passkeyPlugin(): BetterAuthPlugin {
  return {
    id: "passkey",
    endpoints: {
      passkeyRegisterOptions: createAuthEndpoint(
        "/passkey/register/options",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const rp = requireRpContext({
            baseURL: ctx.context.baseURL,
            request: ctx.request ?? null,
          });
          const session = ctx.context.session!;
          const db = getDb();
          const existing = await db
            .select({ credentialId: passkey.credentialId })
            .from(passkey)
            .where(eq(passkey.userId, session.user.id));
          const options = await generateRegistrationOptions({
            rpName: "家庭时间胶囊",
            rpID: rp.rpId,
            userID: new TextEncoder().encode(session.user.id),
            userName: session.user.email,
            userDisplayName: session.user.name || session.user.email,
            attestationType: "none",
            excludeCredentials: existing.map((row) => ({
              id: row.credentialId as Base64URLString,
            })),
            authenticatorSelection: {
              residentKey: "required",
              userVerification: "preferred",
            },
          });
          await adapterOf(ctx.context).createVerificationValue({
            value: options.challenge,
            identifier: `${REGISTER_CHALLENGE_PREFIX}:${session.user.id}`,
            expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
          });
          return ctx.json({ options });
        },
      ),

      passkeyRegisterVerify: createAuthEndpoint(
        "/passkey/register/verify",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const rp = requireRpContext({
            baseURL: ctx.context.baseURL,
            request: ctx.request ?? null,
          });
          const session = ctx.context.session!;
          const body = bodyOf(ctx);
          const credential = body.credential;
          if (!hasResponseShape(credential)) {
            throw new APIError("BAD_REQUEST", { message: "无效的注册响应。" });
          }
          const challenge = await adapterOf(
            ctx.context,
          ).consumeVerificationValue(
            `${REGISTER_CHALLENGE_PREFIX}:${session.user.id}`,
          );
          if (!challenge) {
            throw new APIError("BAD_REQUEST", {
              message: "注册请求已过期，请重新添加。",
            });
          }
          const verification = await verifyRegistrationResponse({
            response: credential,
            expectedChallenge: challenge.value,
            expectedOrigin: rp.origin,
            expectedRPID: rp.rpId,
            requireUserVerification: false,
          });
          if (!verification.verified || !verification.registrationInfo) {
            throw new APIError("BAD_REQUEST", { message: "注册验证未通过。" });
          }
          const info = verification.registrationInfo;
          const db = getDb();
          const existingRow = await db
            .select({ id: passkey.id })
            .from(passkey)
            .where(eq(passkey.credentialId, info.credential.id))
            .limit(1);
          if (existingRow.length > 0) {
            throw new APIError("CONFLICT", {
              message: "该通行密钥已在本实例注册。",
            });
          }
          const label = pickString(body.label, 50) ?? "通行密钥";
          await db.insert(passkey).values({
            id: randomUUID(),
            userId: session.user.id,
            credentialId: info.credential.id,
            publicKey: publicKeyToStorage(info.credential.publicKey),
            counter: info.credential.counter,
            transports: info.credential.transports?.join(",") ?? null,
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
            rpId: rp.rpId,
            label,
          });
          const bound = await db
            .select({ familyId: userTable.familyId })
            .from(userTable)
            .where(eq(userTable.id, session.user.id))
            .limit(1);
          const familyId = bound[0]?.familyId ?? null;
          if (familyId) {
            await recordAudit(familyId, "account.passkey_added", session.user.id, {
              credentialId: info.credential.id,
              label,
            });
          }
          return ctx.json({ ok: true });
        },
      ),

      passkeyAuthenticateOptions: createAuthEndpoint(
        "/passkey/authenticate/options",
        { method: "POST" },
        async (ctx) => {
          const rp = requireRpContext({
            baseURL: ctx.context.baseURL,
            request: ctx.request ?? null,
          });
          const options = await generateAuthenticationOptions({
            rpID: rp.rpId,
            userVerification: "preferred",
          });
          const challengeId = randomUUID();
          await adapterOf(ctx.context).createVerificationValue({
            value: options.challenge,
            identifier: `${AUTH_CHALLENGE_PREFIX}:${challengeId}`,
            expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
          });
          return ctx.json({ options, challengeId });
        },
      ),

      passkeyAuthenticateVerify: createAuthEndpoint(
        "/passkey/authenticate/verify",
        { method: "POST" },
        async (ctx) => {
          const rp = requireRpContext({
            baseURL: ctx.context.baseURL,
            request: ctx.request ?? null,
          });
          const body = bodyOf(ctx);
          const challengeId = pickString(body.challengeId, 64);
          const credential = body.credential;
          if (!challengeId || !isAuthenticationResponse(credential)) {
            throw new APIError("BAD_REQUEST", { message: "无效的登录请求。" });
          }
          const challenge = await adapterOf(
            ctx.context,
          ).consumeVerificationValue(`${AUTH_CHALLENGE_PREFIX}:${challengeId}`);
          if (!challenge) {
            throw new APIError("BAD_REQUEST", {
              message: "登录请求已过期，请重试。",
            });
          }
          const db = getDb();
          const rows = await db
            .select()
            .from(passkey)
            .where(eq(passkey.credentialId, credential.id))
            .limit(1);
          const stored = rows[0];
          if (!stored || stored.rpId !== rp.rpId) {
            throw new APIError("BAD_REQUEST", { message: "通行密钥不可用。" });
          }
          const verification = await verifyAuthenticationResponse({
            response: credential,
            expectedChallenge: challenge.value,
            expectedOrigin: rp.origin,
            expectedRPID: rp.rpId,
            requireUserVerification: false,
            credential: {
              id: stored.credentialId,
              publicKey: publicKeyFromStorage(stored.publicKey),
              counter: stored.counter,
              transports: stored.transports
                ? stored.transports.split(",")
                : undefined,
            },
          });
          if (!verification.verified) {
            throw new APIError("BAD_REQUEST", { message: "通行密钥验证未通过。" });
          }
          // 停用账号在 databaseHooks.session.create.before 里也会被拒绝；
          // 这里提前给出可读错误。
          const accountRows = await db
            .select({ disabledAt: userTable.disabledAt })
            .from(userTable)
            .where(eq(userTable.id, stored.userId))
            .limit(1);
          if (accountRows.length === 0 || accountRows[0]!.disabledAt !== null) {
            throw new APIError("UNAUTHORIZED", { message: "账号或凭据不可用。" });
          }
          const newSession = await adapterOf(ctx.context).createSession(
            stored.userId,
          );
          const updatedUser = await db
            .select()
            .from(userTable)
            .where(eq(userTable.id, stored.userId))
            .limit(1);
          await db
            .update(passkey)
            .set({
              counter: verification.authenticationInfo.newCounter,
              lastUsedAt: new Date(),
            })
            .where(eq(passkey.id, stored.id));
          await setSessionCookie(ctx, {
            session: newSession as never,
            user: updatedUser[0] as never,
          });
          ctx.setHeader("set-auth-token", newSession.token);
          ctx.setHeader("access-control-expose-headers", "set-auth-token");
          return ctx.json({ token: newSession.token });
        },
      ),

      passkeyRemove: createAuthEndpoint(
        "/passkey/remove",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const session = ctx.context.session!;
          const id = pickString(bodyOf(ctx).id, 64);
          if (!id) {
            throw new APIError("BAD_REQUEST", { message: "无效的请求。" });
          }
          const db = getDb();
          const removed = await db
            .delete(passkey)
            .where(and(eq(passkey.id, id), eq(passkey.userId, session.user.id)))
            .returning({ id: passkey.id });
          if (removed.length === 0) {
            throw new APIError("NOT_FOUND", { message: "通行密钥不存在。" });
          }
          const bound = await db
            .select({ familyId: userTable.familyId })
            .from(userTable)
            .where(eq(userTable.id, session.user.id))
            .limit(1);
          const familyId = bound[0]?.familyId ?? null;
          if (familyId) {
            await recordAudit(familyId, "account.passkey_removed", session.user.id, {
              passkeyId: id,
            });
          }
          return ctx.json({ ok: true });
        },
      ),

      passkeyList: createAuthEndpoint(
        "/passkey/list",
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => {
          const session = ctx.context.session!;
          const db = getDb();
          const rows = await db
            .select({
              id: passkey.id,
              label: passkey.label,
              createdAt: passkey.createdAt,
              lastUsedAt: passkey.lastUsedAt,
              deviceType: passkey.deviceType,
              backedUp: passkey.backedUp,
            })
            .from(passkey)
            .where(eq(passkey.userId, session.user.id));
          return ctx.json({
            passkeys: rows.map((row) => ({
              ...row,
              createdAt: row.createdAt?.toISOString() ?? null,
              lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
            })),
          });
        },
      ),
    },
  } as BetterAuthPlugin;
}

export type PasskeyListItem = {
  id: string;
  label: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  deviceType: string | null;
  backedUp: boolean;
};
