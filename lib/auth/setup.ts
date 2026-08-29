import { count } from "drizzle-orm";
import { getDb } from "@/db";
import { user as userTable } from "@/db/schema/auth";
import { safeTokenEqual } from "./token";
import { getAuth } from "./auth";

/**
 * 首次管理员初始化（docs/SECURITY.md 威胁模型）：
 * - 仅当数据库中不存在任何 User 时可用；
 * - 必须提供环境变量 INITIAL_SETUP_TOKEN（timing-safe 比较）；
 * - token 不入库；初始化成功后本流程永久失效（以“无用户”为闸门）。
 */

export type SetupState = {
  hasUsers: boolean;
  tokenConfigured: boolean;
};

export type SetupInput = {
  token: string;
  displayName: string;
  email: string;
  password: string;
};

export type SetupFailure =
  | "not_configured"
  | "already_initialized"
  | "invalid_token"
  | "invalid_input"
  | "creation_failed";

export type SetupResult = { ok: true } | { ok: false; error: SetupFailure };

export function getExpectedSetupToken(): string | undefined {
  const token = process.env.INITIAL_SETUP_TOKEN?.trim();
  return token ? token : undefined;
}

export async function countUsers(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ value: count() }).from(userTable);
  return Number(rows[0]?.value ?? 0);
}

export async function getSetupState(): Promise<SetupState> {
  const [hasUsers, tokenConfigured] = await Promise.all([
    countUsers().then((n) => n > 0),
    Promise.resolve(Boolean(getExpectedSetupToken())),
  ]);
  return { hasUsers, tokenConfigured };
}

export function validateSetupInput(input: SetupInput): boolean {
  const displayName = input.displayName.trim();
  const email = input.email.trim().toLowerCase();
  if (displayName.length < 1 || displayName.length > 50) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  if (input.password.length < 10 || input.password.length > 128) return false;
  return true;
}

// 串行化初始化请求，避免并发窗口内创建多个管理员
let setupChain: Promise<unknown> = Promise.resolve();

export function performSetup(input: SetupInput): Promise<SetupResult> {
  const run = setupChain.then(() => doSetup(input));
  setupChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function doSetup(input: SetupInput): Promise<SetupResult> {
  const expected = getExpectedSetupToken();
  if (!expected) return { ok: false, error: "not_configured" };
  if ((await countUsers()) > 0) return { ok: false, error: "already_initialized" };
  if (!validateSetupInput(input)) return { ok: false, error: "invalid_input" };
  if (!safeTokenEqual(input.token, expected)) {
    return { ok: false, error: "invalid_token" };
  }
  try {
    const auth = getAuth();
    await auth.api.signUpEmail({
      body: {
        name: input.displayName.trim(),
        email: input.email.trim().toLowerCase(),
        password: input.password,
      },
    });
  } catch {
    return { ok: false, error: "creation_failed" };
  }
  // 以数据库为准确认创建成功（不依赖响应形态）
  if ((await countUsers()) !== 1) return { ok: false, error: "creation_failed" };
  return { ok: true };
}
