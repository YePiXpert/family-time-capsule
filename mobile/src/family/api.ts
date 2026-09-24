import { SERVICE_URL } from "../local/brand";
import { getToken } from "./session";
import type { PairBinding } from "./recovery";
/**
 * 家庭与设备唯一的联网文件（宪法白名单里的第三个）：开家庭、扫码配对、凭恢复码找回、管理家人与设备。
 * 只收发 JSON；钥匙包、恢复包在别处封好、这里原样转交，服务端从不见内容钥匙。
 * 请求函数可注入：真机用 fetch，vitest 端到端直连本机起的服务端。
 */
export type Role = "admin" | "member";
export type FamilyMember = { id: string; name: string; role: Role; enabled: boolean };
export type FamilyInfo = {
  familyId: string;
  keyId: string;
  recoveryVersion: number;
  me: { memberId: string; deviceId: string; name: string; role: Role };
  members: FamilyMember[];
};
export type DeviceRow = {
  id: string;
  member_id: string;
  name: string;
  revoked: number;
  created_at: number;
  last_used_at: number | null;
  approved_by: string | null;
  pending: number;
};
export type Joined = {
  token: string;
  member: { id: string; name: string; role: Role; deviceId: string };
};
export type PendingPair = {
  requestId: string;
  deviceId: string;
  deviceName: string;
  publicKey: string;
  status: "pending" | "approved" | "confirmed" | "cancelled" | "expired";
  expiresAt: string;
  familyId: string;
  keyId: string;
};
export type Collected =
  | { status: "pending" }
  | {
      status: "approved";
      token: string;
      binding: PairBinding;
      enc: string;
      ct: string;
      member: Joined["member"];
    };
export type Recovered = Joined & {
  familyId: string;
  keyId: string;
  recovery: { envelope: string; version: number };
};
export type RecoveryInput = { envelope: string; verifier: string };
export class FamilyError extends Error {
  code: string;
  status: number | null;
  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "FamilyError";
    this.code = code;
    this.status = status;
  }
}
export type FamilyRequest = (
  method: string,
  path: string,
  body: unknown,
  token: string | null,
  signal?: AbortSignal,
) => Promise<{ status: number; json: unknown }>;
const TIMEOUT_MS = 30000;
/** 真机：fetch + 超时；网络不通、超时、取消各给一句人话。 */
export const fetchRequest =
  (base: string = SERVICE_URL): FamilyRequest =>
  async (method, path, body, token, signal) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel);
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(cancel, TIMEOUT_MS);
    try {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json: unknown = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }
      return { status: response.status, json };
    } catch {
      throw signal?.aborted
        ? new FamilyError("CANCELED", "已停止。")
        : new FamilyError("NETWORK", "现在连不上服务，请稍后再试。");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  };
export function createFamilyApi(
  request: FamilyRequest = fetchRequest(),
  token: () => Promise<string | null> = getToken,
) {
  /** 2xx 返回 JSON；其余按服务端的 code 与中文 message 抛 FamilyError。 */
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { auth?: boolean | string; signal?: AbortSignal } = {},
  ): Promise<{ status: number; value: T }> => {
    const bearer =
      typeof opts.auth === "string"
        ? opts.auth
        : opts.auth === false
          ? null
          : await token();
    const { status, json } = await request(method, path, body, bearer, opts.signal);
    if (status >= 200 && status < 300) return { status, value: json as T };
    const error = (json ?? {}) as { code?: unknown; message?: unknown };
    throw new FamilyError(
      typeof error.code === "string" ? error.code : "SERVER_ERROR",
      typeof error.message === "string" ? error.message : "服务暂时不可用，请稍后再试。",
      status,
    );
  };
  const value = async <T>(...args: Parameters<typeof call>) =>
    (await call<T>(...args)).value;
  return {
    status: (signal?: AbortSignal) =>
      value<{ initialized: boolean; family: boolean }>("GET", "/status", undefined, { auth: false, signal }),
    /** 没有家庭时抛 FAMILY_MISSING（1.0.8 的主人手机要先升级）。 */
    family: (signal?: AbortSignal) => value<FamilyInfo>("GET", "/family", undefined, { signal }),
    activate: (input: {
      activationCode: string;
      memberId: string;
      memberName: string;
      deviceName: string;
      publicKey: string;
      familyId: string;
      keyId: string;
      recovery: RecoveryInput;
    }) => value<Joined>("POST", "/family/activate", input, { auth: false }),
    upgrade: (input: { publicKey: string; familyId: string; keyId: string; recovery: RecoveryInput }) =>
      value<{ familyId: string; keyId: string; recoveryVersion: number }>("POST", "/family/upgrade", input),
    createPair: (input: { publicKey: string; deviceName: string; claimHash: string }) =>
      value<{ requestId: string; expiresAt: string }>("POST", "/pair/requests", input, { auth: false }),
    pairForApprover: (requestId: string) =>
      value<PendingPair>("GET", `/pair/requests/${requestId}`),
    approvePair: (
      requestId: string,
      input: { member: { id: string; name?: string; role?: Role }; enc: string; ct: string },
    ) => value<{ binding: PairBinding }>("POST", `/pair/requests/${requestId}/approve`, input),
    collectPair: async (requestId: string, claim: string, signal?: AbortSignal) =>
      (await call<Collected>("POST", `/pair/requests/${requestId}/collect`, { claim }, { auth: false, signal })).value,
    /** 用刚领到的令牌确认，不读钥匙串里的旧值。 */
    confirmPair: (requestId: string, newToken: string) =>
      value<{ ok: true }>("POST", `/pair/requests/${requestId}/confirm`, {}, { auth: newToken }),
    cancelPairAsDevice: (requestId: string, claim: string) =>
      value<{ ok: true }>("POST", `/pair/requests/${requestId}/cancel`, { claim }, { auth: false }),
    cancelPairAsAdmin: (requestId: string) =>
      value<{ ok: true }>("POST", `/pair/requests/${requestId}/cancel`, {}),
    recoveryAdmins: (proof: string) =>
      value<{ admins: { id: string; name: string }[] }>("POST", "/recovery/claim", { proof }, { auth: false }),
    recoverAdmin: (input: { proof: string; memberId: string; deviceName: string; publicKey: string }) =>
      value<Recovered>("POST", "/recovery/claim", input, { auth: false }),
    setRecovery: (input: { keyId: string; version: number; envelope: string; verifier: string }) =>
      value<{ ok: true }>("PUT", "/admin/recovery", input),
    overview: () =>
      value<{ members: (FamilyMember & { enabled: number })[]; devices: DeviceRow[] }>("GET", "/admin/overview"),
    setProfile: (memberId: string, input: { name: string; role: Role }) =>
      value<{ ok: true }>("PUT", `/admin/members/${memberId}/profile`, input),
    setEnabled: (memberId: string, input: { enabled: boolean; photoLimit: number; writeLimit: number }) =>
      value<{ ok: true }>("PATCH", `/admin/members/${memberId}`, input),
    revokeDevice: (deviceId: string) =>
      value<{ ok: true }>("DELETE", `/admin/devices/${deviceId}`),
    /** 这台手机退出家庭：服务端作废自己的令牌。 */
    leave: () => value<{ ok: true }>("POST", "/me/leave", {}),
  };
}
export type FamilyApi = ReturnType<typeof createFamilyApi>;
