import { getRandomBytes } from "expo-crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  KEY_BYTES,
  fromBase64,
  keyIdOf,
  keyToHex,
  toBase64,
} from "../sync/crypto";
import { hpkeOpen, hpkeSeal } from "./hpke";
/**
 * 家庭的两样钥匙怎么到达一台手机（计划第五、六节）：
 *
 * 恢复秘密 R：16 字节随机，和内容钥匙 K 各自独立生成——本模块没有任何函数由 K 推出 R 或反过来。
 * 管理者把 R 的 12 个英文词抄在纸上；手机和服务器都不存 R。由 R 用 HKDF 分出两样：
 *   proof = HKDF(R, "anan-recovery-auth-v1")  交给服务端核对（服务端只存 sha256(proof 的 hex)）
 *   wrap  = HKDF(R, "anan-recovery-wrap-v1")  封 K 成恢复包，AAD 绑家庭、钥匙指纹与恢复版本
 * 看到 proof 推不出 wrap，所以服务器拿着恢复包也解不开 K。
 *
 * 钥匙包：管理者扫码后用 HPKE PSK 模式把 K 封给新手机的公钥，PSK 是只在二维码里的 32 字节秘密 S；
 * info 绑家庭与申请，AAD 绑整条授权（成员、角色、设备、批准者、指纹、过期时间），解开后逐项核对。
 *
 * 随机只取 expo-crypto（Hermes 没有 crypto.getRandomValues）；每个要随机的函数都能注入。
 */
export const RECOVERY_BYTES = 16;
/** 恢复包格式版本：0x01 ‖ nonce 24 ‖ XChaCha20-Poly1305 密文。 */
export const RECOVERY_ENVELOPE_V1 = 0x01;
/** 钥匙包明文的版本字段。 */
export const PAIR_PAYLOAD_V1 = 1;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;
const WORDS_WRONG = "恢复码不对，请逐个词核对。";
const RECOVERY_WRONG = "恢复码打不开这个家庭的钥匙，请核对后再试。";
const PAIR_WRONG = "这份授权对不上，请让管理者重新扫码。";
const utf8 = (text: string) => new TextEncoder().encode(text);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const isRecovery = (r: unknown): r is Uint8Array =>
  r instanceof Uint8Array &&
  r.length === RECOVERY_BYTES &&
  !r.every((b) => b === 0);
const derive = (r: Uint8Array, info: string) =>
  hkdf(sha256, r, undefined, utf8(info), 32);
/** 生成恢复秘密 R：只从 expo-crypto 取随机字节，与 K 无关。 */
export function newRecoverySecret(
  random: (bytes: number) => Uint8Array = getRandomBytes,
): Uint8Array {
  const r = random(RECOVERY_BYTES);
  if (!isRecovery(r)) throw new Error("生成恢复码失败。");
  return r;
}
/** 12 个英文词（BIP39，与抄写／核对界面沿用同一张词表）。 */
export function recoveryWordsOf(r: Uint8Array): string {
  if (!isRecovery(r)) throw new Error("恢复码格式不对。");
  return entropyToMnemonic(r, wordlist);
}
/** 规整空白与大小写后校验；错一个词、少一个词、校验和不对、全零都只说一句人话。 */
export function recoveryFromWords(words: string): Uint8Array {
  const normalized = String(words ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .join(" ");
  let r: Uint8Array;
  try {
    if (!normalized || !validateMnemonic(normalized, wordlist)) throw 0;
    r = mnemonicToEntropy(normalized, wordlist);
  } catch {
    throw new Error(WORDS_WRONG);
  }
  if (!isRecovery(r)) throw new Error(WORDS_WRONG);
  return r;
}
/** 恢复证明：hex(HKDF(R, "anan-recovery-auth-v1", 32))，找回时交给服务端。 */
export function recoveryProofOf(r: Uint8Array): string {
  if (!isRecovery(r)) throw new Error("恢复码格式不对。");
  return bytesToHex(derive(r, "anan-recovery-auth-v1"));
}
/** 服务端存的核对值：sha256(proof 的 hex 字符串)，服务端用同一算法核对。 */
export function recoveryVerifierOf(proofHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(proofHex)) throw new Error("恢复证明格式不对。");
  return bytesToHex(sha256(utf8(proofHex)));
}
const recoveryAad = (familyId: string, keyId: string, version: number) =>
  utf8(`anan-recovery-v1|${familyId}|${keyId}|${version}`);
/**
 * 用 R 封 K 成恢复包（标准 base64）：0x01 ‖ nonce(24) ‖ XChaCha20-Poly1305(wrap, nonce, K, aad)。
 * nonce 随机（每次重新生成恢复码都是新的 R，本来也不会撞）。
 */
export function wrapContentKey(
  r: Uint8Array,
  key: Uint8Array,
  ctx: { familyId: string; version: number },
  random: (bytes: number) => Uint8Array = getRandomBytes,
): string {
  if (!isRecovery(r)) throw new Error("恢复码格式不对。");
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES)
    throw new Error("钥匙格式不对。");
  const nonce = random(NONCE_BYTES);
  if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES)
    throw new Error("生成随机数失败。");
  const aad = recoveryAad(ctx.familyId, keyIdOf(key), ctx.version);
  const ct = xchacha20poly1305(
    derive(r, "anan-recovery-wrap-v1"),
    nonce,
    aad,
  ).encrypt(key);
  return toBase64(concat(new Uint8Array([RECOVERY_ENVELOPE_V1]), nonce, ct));
}
/** 用 R 解开恢复包；AAD 由调用方给的家庭、指纹、版本重建，解开后再核对指纹。 */
export function unwrapContentKey(
  r: Uint8Array,
  envelopeB64: string,
  ctx: { familyId: string; keyId: string; version: number },
): Uint8Array {
  let key: Uint8Array;
  try {
    if (!isRecovery(r)) throw 0;
    const bytes = fromBase64(envelopeB64);
    if (
      bytes.length !== 1 + NONCE_BYTES + KEY_BYTES + TAG_BYTES ||
      bytes[0] !== RECOVERY_ENVELOPE_V1
    )
      throw 0;
    key = xchacha20poly1305(
      derive(r, "anan-recovery-wrap-v1"),
      bytes.subarray(1, 1 + NONCE_BYTES),
      recoveryAad(ctx.familyId, ctx.keyId, ctx.version),
    ).decrypt(bytes.subarray(1 + NONCE_BYTES));
  } catch {
    throw new Error(RECOVERY_WRONG);
  }
  if (key.length !== KEY_BYTES || keyIdOf(key) !== ctx.keyId)
    throw new Error(RECOVERY_WRONG);
  return key;
}
/** 管理者批准的一条授权；全部字段进 AAD，新手机解开后逐项对得上才收下钥匙。 */
export type PairBinding = {
  familyId: string;
  requestId: string;
  memberId: string;
  role: "admin" | "member";
  deviceId: string;
  deviceName: string;
  approverDeviceId: string;
  keyId: string;
  expiresAt: string;
};
/** 授权的 AAD：固定顺序的 JSON 数组，两端逐字节相同。 */
export const bindingBytes = (b: PairBinding) =>
  utf8(
    JSON.stringify([
      "anan-pair-v1",
      b.familyId,
      b.requestId,
      b.memberId,
      b.role,
      b.deviceId,
      b.deviceName,
      b.approverDeviceId,
      b.keyId,
      b.expiresAt,
    ]),
  );
const pairInfo = (b: PairBinding) =>
  utf8(`anan-pair-v1|${b.familyId}|${b.requestId}`);
const PAIR_PSK_ID = utf8("anan-pair-psk-v1");
/** 管理者手机：把 K 用 HPKE PSK 模式封给新手机的公钥，PSK 是二维码里的 32 字节秘密。 */
export function sealContentKeyForDevice(opts: {
  recipientPublicKey: Uint8Array;
  psk: Uint8Array;
  binding: PairBinding;
  key: Uint8Array;
  random?: (bytes: number) => Uint8Array;
}): { enc: string; ct: string } {
  const { binding, key } = opts;
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES)
    throw new Error("钥匙格式不对。");
  // 授权里的指纹必须就是要交出去的这把钥匙，免得封出一个新手机注定解不开的包。
  if (keyIdOf(key) !== binding.keyId) throw new Error("钥匙与授权对不上。");
  if (!(opts.psk instanceof Uint8Array) || opts.psk.length !== 32)
    throw new Error("二维码里的秘密格式不对。");
  const plaintext = utf8(
    JSON.stringify({
      v: PAIR_PAYLOAD_V1,
      key: keyToHex(key),
      familyId: binding.familyId,
    }),
  );
  const sealed = hpkeSeal({
    recipientPublicKey: opts.recipientPublicKey,
    info: pairInfo(binding),
    aad: bindingBytes(binding),
    plaintext,
    psk: { key: opts.psk, id: PAIR_PSK_ID },
    random: opts.random,
  });
  return { enc: toBase64Url(sealed.enc), ct: toBase64Url(sealed.ct) };
}
/**
 * 新手机：用自己的私钥和二维码里的秘密解开钥匙包。服务器没有这两样，伪造的包解不开；
 * 解开后再核对版本、家庭、钥匙长度与指纹，任何一项不对都不收。
 */
export function openContentKeyForDevice(opts: {
  secretKey: Uint8Array;
  psk: Uint8Array;
  binding: PairBinding;
  enc: string;
  ct: string;
}): Uint8Array {
  const { binding } = opts;
  try {
    if (!(opts.psk instanceof Uint8Array) || opts.psk.length !== 32) throw 0;
    const plain = hpkeOpen({
      recipientSecretKey: opts.secretKey,
      enc: fromBase64Url(opts.enc),
      info: pairInfo(binding),
      aad: bindingBytes(binding),
      ct: fromBase64Url(opts.ct),
      psk: { key: opts.psk, id: PAIR_PSK_ID },
    });
    const payload: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (!payload || typeof payload !== "object") throw 0;
    const { v, key, familyId } = payload as Record<string, unknown>;
    if (
      v !== PAIR_PAYLOAD_V1 ||
      familyId !== binding.familyId ||
      typeof key !== "string" ||
      !/^[0-9a-f]{32}$/.test(key)
    )
      throw 0;
    const k = hexToBytes(key);
    if (k.length !== KEY_BYTES || keyIdOf(k) !== binding.keyId) throw 0;
    return k;
  } catch {
    throw new Error(PAIR_WRONG);
  }
}
const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** base64url，不带补位（RFC 4648 第 5 节）；钥匙包在 JSON 与二维码里都用它。 */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
/** 严格解析：只认 base64url 字母表、不带补位、长度余 1 与多余的尾位都拒绝。 */
export function fromBase64Url(text: string): Uint8Array {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text))
    throw new Error("base64url 格式不对。");
  const rest = text.length % 4;
  if (rest === 1) throw new Error("base64url 格式不对。");
  // 余 2／3 时最后一个字符只有前 4／2 位有效，其余位必须为 0，保证一份字节只有一种写法。
  if (rest) {
    const last = B64URL.indexOf(text[text.length - 1]!);
    if (last & (rest === 2 ? 0b1111 : 0b11))
      throw new Error("base64url 格式不对。");
  }
  const padded =
    text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - rest) % 4);
  return fromBase64(padded);
}
