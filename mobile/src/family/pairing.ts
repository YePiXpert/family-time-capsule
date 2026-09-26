import { getRandomBytes, randomUUID } from "expo-crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { keyIdOf, newMasterKey } from "../sync/crypto";
import { loadKey, storeKey } from "../sync/state";
import { FamilyError, type FamilyApi, type FamilyInfo, type PendingPair, type Role } from "./api";
import { ensureDeviceKey, type DeviceKey } from "./keys";
import { saveToken } from "./session";
import {
  fromBase64Url,
  newRecoverySecret,
  openContentKeyForDevice,
  recoveryFromWords,
  recoveryProofOf,
  recoveryVerifierOf,
  recoveryWordsOf,
  sealContentKeyForDevice,
  toBase64Url,
  unwrapContentKey,
  wrapContentKey,
  type PairBinding,
} from "./recovery";
/**
 * 家庭与设备的几条流程（PLAN-FAMILY-DEVICES.md 第六节），不碰界面：
 * - 新手机：登记申请、出二维码、等批准、解开钥匙包、存好令牌与钥匙后确认；
 * - 管理者：扫码核对（公钥与服务端一致、钥匙指纹对得上）、封钥匙包、批准；
 * - 开家庭（激活码）、1.0.8 主人手机升级、凭恢复码找回、重新生成恢复码。
 * 存储与随机都可注入：端到端测试里两台「手机」各有一只保险箱。
 */
export type Vault = {
  loadKey(): Promise<Uint8Array | null>;
  storeKey(key: Uint8Array): Promise<void>;
  ensureDeviceKey(): Promise<DeviceKey>;
  saveToken(token: string): Promise<void>;
};
export type FlowDeps = {
  api: FamilyApi;
  vault?: Vault;
  random?: (n: number) => Uint8Array;
  uuid?: () => string;
};
const utf8 = (text: string) => new TextEncoder().encode(text);
const deps = (d: FlowDeps) => ({
  api: d.api,
  vault: d.vault ?? deviceVault(),
  random: d.random ?? getRandomBytes,
  uuid: d.uuid ?? randomUUID,
});
/** 真机的保险箱：内容钥匙、设备密钥、设备令牌都在系统钥匙串里。 */
export function deviceVault(): Vault {
  return {
    loadKey,
    storeKey: async (key) => {
      await storeKey(key);
      const back = await loadKey();
      if (!back || keyIdOf(back) !== keyIdOf(key))
        throw new FamilyError("KEYCHAIN", "这台手机的钥匙串没存住，请再试一次。");
    },
    ensureDeviceKey,
    saveToken,
  };
}
// ── 二维码 ───────────────────────────────────────────────────────────────
const QR_PREFIX = "anan-pair:1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type PairQr = { requestId: string; publicKey: Uint8Array; psk: Uint8Array };
/** 二维码里只有申请号、新手机公钥和一次性秘密 S；S 从不经过服务器。 */
export const pairQrText = (qr: PairQr) =>
  `${QR_PREFIX}${qr.requestId}:${toBase64Url(qr.publicKey)}:${toBase64Url(qr.psk)}`;
export function parsePairQr(text: string): PairQr {
  const wrong = () => new FamilyError("QR_INVALID", "这不是桉桉成长记的加入二维码。");
  if (typeof text !== "string" || !text.startsWith(QR_PREFIX)) throw wrong();
  const [requestId, publicKey, psk, ...rest] = text.slice(QR_PREFIX.length).split(":");
  if (rest.length || !requestId || !UUID.test(requestId) || !publicKey || !psk) throw wrong();
  try {
    const qr = { requestId, publicKey: fromBase64Url(publicKey), psk: fromBase64Url(psk) };
    if (qr.publicKey.length !== 32 || qr.psk.length !== 32) throw wrong();
    return qr;
  } catch {
    throw wrong();
  }
}
// ── 新手机 ───────────────────────────────────────────────────────────────
export type JoinRequest = {
  requestId: string;
  deviceName: string;
  expiresAt: string;
  /** 领取凭据：只在本机，服务端只存它的哈希。 */
  claim: string;
  psk: Uint8Array;
  qr: string;
};
export type JoinedFamily = {
  key: Uint8Array;
  familyId: string;
  keyId: string;
  member: { id: string; name: string; role: Role; deviceId: string };
};
/** 登记一条加入申请并生成二维码；申请本身不带任何权限，10 分钟后过期。 */
export async function requestToJoin(d: FlowDeps, deviceName: string): Promise<JoinRequest> {
  const { api, vault, random } = deps(d);
  const device = await vault.ensureDeviceKey();
  const psk = random(32),
    claim = bytesToHex(random(16));
  const created = await api.createPair({
    publicKey: toBase64Url(device.publicKey),
    deviceName: deviceName.trim(),
    claimHash: bytesToHex(sha256(utf8(claim))),
  });
  return {
    requestId: created.requestId,
    deviceName: deviceName.trim(),
    expiresAt: created.expiresAt,
    claim,
    psk,
    qr: pairQrText({ requestId: created.requestId, publicKey: device.publicKey, psk }),
  };
}
/**
 * 钥匙和令牌都已存进钥匙串、只差确认的加入（只在内存里，随这条申请一起丢）。确认其实成功了、回应却丢了时，
 * 再领只会得到「这台手机已经加入了」；所以再轮询时不再去领，用最后领到的那枚令牌再确认一次——
 * 服务端对已确认的申请照样回成功，还没确认的就此确认。
 */
const collected = new WeakMap<JoinRequest, { token: string; joined: JoinedFamily }>();
/** 这条申请已经领到钥匙、只差确认：二维码过了时限也照样再确认。 */
export const awaitingConfirm = (join: JoinRequest) => collected.has(join);
/**
 * 看一眼批准了没有：还在等就返回 null。批准了就核对授权是给这条申请、这台手机的，
 * 用本机私钥和二维码里的 S 解开钥匙包（服务器伪造的解不开），先把钥匙和令牌存进钥匙串，
 * 存好了才确认——确认前任何一步失败，24 小时后服务端自己作废这台设备。
 */
export async function pollJoin(
  d: FlowDeps,
  join: JoinRequest,
  signal?: AbortSignal,
): Promise<JoinedFamily | null> {
  const { api, vault } = deps(d);
  const saved = collected.get(join);
  if (saved) {
    await api.confirmPair(join.requestId, saved.token);
    collected.delete(join);
    return saved.joined;
  }
  const got = await api.collectPair(join.requestId, join.claim, signal);
  if (got.status === "pending") return null;
  const b = got.binding;
  if (
    b.requestId !== join.requestId ||
    b.deviceName !== join.deviceName ||
    got.member.deviceId !== b.deviceId ||
    got.member.id !== b.memberId
  )
    throw new FamilyError("PAIR_MISMATCH", "这份授权对不上，请让管理者重新扫码。");
  const device = await vault.ensureDeviceKey();
  const key = openContentKeyForDevice({
    secretKey: device.secretKey,
    psk: join.psk,
    binding: b,
    enc: got.enc,
    ct: got.ct,
  });
  await vault.storeKey(key);
  await vault.saveToken(got.token);
  const joined = { key, familyId: b.familyId, keyId: b.keyId, member: got.member };
  collected.set(join, { token: got.token, joined });
  await api.confirmPair(join.requestId, got.token);
  collected.delete(join);
  return joined;
}
export const cancelJoin = (d: FlowDeps, join: JoinRequest) =>
  deps(d).api.cancelPairAsDevice(join.requestId, join.claim);
// ── 管理者 ───────────────────────────────────────────────────────────────
export type Inspected = { qr: PairQr; pending: PendingPair; family: FamilyInfo };
/**
 * 扫到二维码后先核对，再给人看「要加进来的是哪台手机」：
 * 服务端给的公钥必须和二维码里的一模一样（被替换就停），申请还挂着，这台手机的钥匙就是家庭的钥匙。
 */
export async function inspectJoin(d: FlowDeps, qrText: string): Promise<Inspected> {
  const { api, vault } = deps(d);
  const qr = parsePairQr(qrText);
  const [pending, family] = await Promise.all([api.pairForApprover(qr.requestId), api.family()]);
  if (family.me.role !== "admin")
    throw new FamilyError("ADMIN_ONLY", "只有管理者能加家人的手机。");
  if (pending.publicKey !== toBase64Url(qr.publicKey))
    throw new FamilyError(
      "PAIR_MISMATCH",
      "二维码和服务器上的申请对不上，已停止。请让对方关掉重新打开二维码。",
    );
  if (pending.status !== "pending")
    throw new FamilyError(
      "PAIR_CLOSED",
      pending.status === "expired" ? "这个二维码过期了，请让对方重新打开。" : "这条申请已经处理过了。",
    );
  const key = await vault.loadKey();
  if (!key || keyIdOf(key) !== pending.keyId || pending.keyId !== family.keyId)
    throw new FamilyError("KEY_MISMATCH", "这台手机的钥匙和家庭对不上，不能批准。");
  return { qr, pending, family };
}
export type ApproveChoice =
  | { kind: "new"; name: string; role: Role }
  | { kind: "existing"; memberId: string };
/** 批准：把内容钥匙封给新手机，授权的每个字段都进 AAD；服务端记下的授权必须与封进去的一字不差。 */
export async function approveJoin(
  d: FlowDeps,
  inspected: Inspected,
  choice: ApproveChoice,
): Promise<PairBinding> {
  const { api, vault, random, uuid } = deps(d);
  const { qr, pending, family } = inspected;
  const key = await vault.loadKey();
  if (!key || keyIdOf(key) !== pending.keyId)
    throw new FamilyError("KEY_MISMATCH", "这台手机的钥匙和家庭对不上，不能批准。");
  let member: { id: string; name?: string; role?: Role }, role: Role;
  if (choice.kind === "new") {
    const name = choice.name.trim();
    if (!name) throw new FamilyError("INVALID_INPUT", "新增家人要填称呼。");
    member = { id: uuid(), name, role: choice.role };
    role = choice.role;
  } else {
    const existing = family.members.find((m) => m.id === choice.memberId);
    if (!existing) throw new FamilyError("NOT_FOUND", "家里没有这位家人，请刷新后再试。");
    member = { id: existing.id };
    role = existing.role;
  }
  const binding: PairBinding = {
    familyId: pending.familyId,
    requestId: pending.requestId,
    memberId: member.id,
    role,
    deviceId: pending.deviceId,
    deviceName: pending.deviceName,
    approverDeviceId: family.me.deviceId,
    keyId: pending.keyId,
    expiresAt: pending.expiresAt,
  };
  const sealed = sealContentKeyForDevice({
    recipientPublicKey: qr.publicKey,
    psk: qr.psk,
    binding,
    key,
    random,
  });
  const result = await api.approvePair(pending.requestId, { member, ...sealed });
  const fields = Object.keys(binding) as (keyof PairBinding)[];
  if (fields.some((f) => result.binding[f] !== binding[f])) {
    // 服务端记下的授权和封进去的不一样：新手机注定解不开，撤回这次批准。
    await api.cancelPairAsAdmin(pending.requestId).catch(() => undefined);
    throw new FamilyError("PAIR_MISMATCH", "服务器记下的授权和这台手机封的不一样，已撤回，请重新扫码。");
  }
  return binding;
}
// ── 开家庭、升级、恢复码 ─────────────────────────────────────────────────
/** 本机已有内容钥匙就沿用（远端已有的内容照样解得开），没有就生成一把；先存进钥匙串再上报。 */
async function contentKey(vault: Vault, random: (n: number) => Uint8Array) {
  const existing = await vault.loadKey();
  if (existing) return existing;
  const key = newMasterKey(random);
  await vault.storeKey(key);
  return key;
}
function recoveryFor(key: Uint8Array, familyId: string, version: number, random: (n: number) => Uint8Array) {
  const secret = newRecoverySecret(random);
  return {
    words: recoveryWordsOf(secret),
    recovery: {
      envelope: wrapContentKey(secret, key, { familyId, version }, random),
      verifier: recoveryVerifierOf(recoveryProofOf(secret)),
    },
  };
}
export type PreparedFamilyStart = {
  words: string;
  familyId: string;
  key: Uint8Array;
  input: Parameters<FamilyApi["activate"]>[0];
};
/** 先备好钥匙与恢复码供人抄写核对；此时不建家庭，恢复秘密只留在这份内存结果里。 */
export async function prepareFamilyStart(
  d: FlowDeps,
  input: { activationCode: string; memberName: string; deviceName: string },
): Promise<PreparedFamilyStart> {
  const { vault, random, uuid } = deps(d);
  const key = await contentKey(vault, random);
  const device = await vault.ensureDeviceKey();
  const familyId = uuid();
  const { words, recovery } = recoveryFor(key, familyId, 1, random);
  return {
    words,
    familyId,
    key,
    input: {
      activationCode: input.activationCode.trim(),
      memberId: uuid(),
      memberName: input.memberName.trim(),
      deviceName: input.deviceName.trim(),
      publicKey: toBase64Url(device.publicKey),
      familyId,
      keyId: keyIdOf(key),
      recovery,
    },
  };
}
/** 核对纸上的恢复码后提交同一份恢复包；响应丢失或令牌没存住时，纸上那套仍可找回。 */
export async function completeFamilyStart(d: FlowDeps, prepared: PreparedFamilyStart): Promise<void> {
  const { api, vault } = deps(d);
  const joined = await api.activate(prepared.input);
  await vault.saveToken(joined.token);
}
/** 空服务开家庭的组合流程；界面分开调用准备与提交，先让管理者抄好恢复码。 */
export async function startFamily(
  d: FlowDeps,
  input: { activationCode: string; memberName: string; deviceName: string },
): Promise<{ words: string; familyId: string; key: Uint8Array }> {
  const prepared = await prepareFamilyStart(d, input);
  await completeFamilyStart(d, prepared);
  const { words, familyId, key } = prepared;
  return { words, familyId, key };
}
/** 1.0.8 的主人手机（已有令牌、还没有家庭行）：升级为家庭管理者，只发生一次。 */
export async function upgradeFamily(d: FlowDeps): Promise<{ words: string; familyId: string; key: Uint8Array }> {
  const { api, vault, random, uuid } = deps(d);
  const key = await contentKey(vault, random);
  const device = await vault.ensureDeviceKey();
  const familyId = uuid();
  const { words, recovery } = recoveryFor(key, familyId, 1, random);
  await api.upgrade({ publicKey: toBase64Url(device.publicKey), familyId, keyId: keyIdOf(key), recovery });
  return { words, familyId, key };
}
export type PreparedRecovery = {
  words: string;
  input: Parameters<FamilyApi["setRecovery"]>[0];
};
/**
 * 换恢复码第一步：备好新的一套供抄写核对，此时还没交给服务，纸上旧的那套照样能用。
 * 新词只在这份内存结果里；核对后再用 submitRecovery 交同一份。
 */
export async function prepareRecovery(d: FlowDeps): Promise<PreparedRecovery> {
  const { api, vault, random } = deps(d);
  const family = await api.family();
  if (family.me.role !== "admin") throw new FamilyError("ADMIN_ONLY", "只有管理者能换恢复码。");
  const key = await vault.loadKey();
  if (!key || keyIdOf(key) !== family.keyId)
    throw new FamilyError("KEY_MISMATCH", "这台手机的钥匙和家庭对不上。");
  const version = family.recoveryVersion + 1;
  const { words, recovery } = recoveryFor(key, family.familyId, version, random);
  return { words, input: { keyId: family.keyId, version, ...recovery } };
}
/**
 * 换恢复码第二步：交上已核对的那一份，生效后旧的作废。响应丢了可以原样再交，服务把同一份重交当作成功。
 */
export async function submitRecovery(d: FlowDeps, prepared: PreparedRecovery): Promise<void> {
  await deps(d).api.setRecovery(prepared.input);
}
/** 不经界面核对、直接换恢复码的组合流程（测试与脚本用）。 */
export async function regenerateRecovery(d: FlowDeps): Promise<{ words: string }> {
  const prepared = await prepareRecovery(d);
  await submitRecovery(d, prepared);
  return { words: prepared.words };
}
/** 找回第一步：核对恢复码，列出管理者让选「我是谁」。 */
export async function recoveryAdmins(d: FlowDeps, words: string) {
  const secret = recoveryFromWords(words);
  const { admins } = await deps(d).api.recoveryAdmins(recoveryProofOf(secret));
  return { secret, admins };
}
/** 找回第二步：登记这台为管理者手机，用恢复码解开内容钥匙，存好钥匙与令牌。 */
export async function recoverAsAdmin(
  d: FlowDeps,
  secret: Uint8Array,
  memberId: string,
  deviceName: string,
): Promise<JoinedFamily> {
  const { api, vault } = deps(d);
  const device = await vault.ensureDeviceKey();
  const got = await api.recoverAdmin({
    proof: recoveryProofOf(secret),
    memberId,
    deviceName: deviceName.trim(),
    publicKey: toBase64Url(device.publicKey),
  });
  const key = unwrapContentKey(secret, got.recovery.envelope, {
    familyId: got.familyId,
    keyId: got.keyId,
    version: got.recovery.version,
  });
  await vault.storeKey(key);
  await vault.saveToken(got.token);
  return { key, familyId: got.familyId, keyId: got.keyId, member: got.member };
}
