import { getRandomBytes } from "expo-crypto";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { expand, extract } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
/**
 * RFC 9180 HPKE，只做一套固定组合、一次性封装（序号 0）：
 *   KEM  DHKEM(X25519, HKDF-SHA256)  0x0020
 *   KDF  HKDF-SHA256                  0x0001
 *   AEAD ChaCha20-Poly1305            0x0003
 * 模式只有 mode_base（0x00）与 mode_psk（0x01）。配对时管理者把内容钥匙封给新手机的公钥，
 * PSK 是只在二维码里出现的一次性秘密 S——服务器既没有新手机的私钥也没有 S，伪造不出能解开的包。
 *
 * 逐字照 RFC 第 4、5 节写：LabeledExtract／LabeledExpand、ExtractAndExpand、Encap／Decap、
 * KeySchedule、Seal／Open；附录 A.2.1 与 A.2.2 的官方向量在 tests/family-hpke.test.ts 里核对。
 *
 * 随机只取 expo-crypto（Hermes 没有 crypto.getRandomValues，noble 自带的随机在真机上会抛错），
 * 临时私钥可以注入，测试用它复现官方向量。
 */
export type HpkeSealed = { enc: Uint8Array; ct: Uint8Array };
export type HpkePsk = { key: Uint8Array; id: Uint8Array };
const KEM_ID = 0x0020;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0003;
const MODE_BASE = 0x00;
const MODE_PSK = 0x01;
/** Nsecret = Nh = Nk = 32，Nn = 12，Npk = Nsk = 32（X25519）。 */
const N_SECRET = 32;
const N_KEY = 32;
const N_NONCE = 12;
const N_PK = 32;
const N_SK = 32;
const TAG_BYTES = 16;
/** RFC 9180 第 5.1.2 节：PSK 至少 32 字节熵。 */
export const MIN_PSK_BYTES = 32;
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
/** I2OSP(n, 2)：两字节大端。 */
const i2osp2 = (n: number) => new Uint8Array([(n >> 8) & 255, n & 255]);
const EMPTY = new Uint8Array(0);
const HPKE_V1 = utf8("HPKE-v1");
/** KEM 的 suite_id = "KEM" ‖ I2OSP(kem_id, 2)；整套的 suite_id = "HPKE" ‖ kem ‖ kdf ‖ aead。 */
const KEM_SUITE = concat(utf8("KEM"), i2osp2(KEM_ID));
const HPKE_SUITE = concat(
  utf8("HPKE"),
  i2osp2(KEM_ID),
  i2osp2(KDF_ID),
  i2osp2(AEAD_ID),
);
/** LabeledExtract(salt, label, ikm) = Extract(salt, "HPKE-v1" ‖ suite_id ‖ label ‖ ikm)。 */
const labeledExtract = (
  suite: Uint8Array,
  salt: Uint8Array,
  label: string,
  ikm: Uint8Array,
) => extract(sha256, concat(HPKE_V1, suite, utf8(label), ikm), salt);
/** LabeledExpand(prk, label, info, L) = Expand(prk, I2OSP(L, 2) ‖ "HPKE-v1" ‖ suite_id ‖ label ‖ info, L)。 */
const labeledExpand = (
  suite: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
) =>
  expand(
    sha256,
    prk,
    concat(i2osp2(length), HPKE_V1, suite, utf8(label), info),
    length,
  );
/** DHKEM 第 4.1 节：eae_prk = LabeledExtract("", "eae_prk", dh)，再展开出 shared_secret。 */
function extractAndExpand(dh: Uint8Array, kemContext: Uint8Array) {
  const eaePrk = labeledExtract(KEM_SUITE, EMPTY, "eae_prk", dh);
  return labeledExpand(KEM_SUITE, eaePrk, "shared_secret", kemContext, N_SECRET);
}
/** DH(sk, pk)：长度不对、低阶点、全零共享秘密（RFC 7748 第 6.1 节的检查）一律当失败。 */
function dh(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  if (secretKey.length !== N_SK || publicKey.length !== N_PK)
    throw new Error("HPKE 密钥长度不对。");
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(secretKey, publicKey);
  } catch {
    throw new Error("HPKE 共享秘密无效。");
  }
  if (shared.every((b) => b === 0)) throw new Error("HPKE 共享秘密无效。");
  return shared;
}
/** 32 字节随机私钥（X25519 在用时钳位，存原始字节即可）；全零或长度不对就拒绝。 */
function secretFrom(random: (n: number) => Uint8Array): Uint8Array {
  const secretKey = random(N_SK);
  if (
    !(secretKey instanceof Uint8Array) ||
    secretKey.length !== N_SK ||
    secretKey.every((b) => b === 0)
  )
    throw new Error("生成密钥失败。");
  return secretKey;
}
/** 设备密钥对：随机只取 expo-crypto。 */
export function x25519KeyPair(
  random: (n: number) => Uint8Array = getRandomBytes,
): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const secretKey = secretFrom(random);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}
/** Encap(pkR)：enc = pkE，kem_context = enc ‖ pkRm。 */
function encap(recipientPublicKey: Uint8Array, ephemeralSecretKey: Uint8Array) {
  const enc = x25519.getPublicKey(ephemeralSecretKey);
  const shared = dh(ephemeralSecretKey, recipientPublicKey);
  return {
    enc,
    sharedSecret: extractAndExpand(shared, concat(enc, recipientPublicKey)),
  };
}
/** Decap(enc, skR)：kem_context = enc ‖ pkRm，pkRm 由自己的私钥算出。 */
function decap(enc: Uint8Array, recipientSecretKey: Uint8Array) {
  const shared = dh(recipientSecretKey, enc);
  const pkRm = x25519.getPublicKey(recipientSecretKey);
  return extractAndExpand(shared, concat(enc, pkRm));
}
/** VerifyPSKInputs：有 PSK 就必须有 id，且 PSK 够长；base 模式两者都为空。 */
function pskInputs(psk: HpkePsk | undefined) {
  if (!psk) return { mode: MODE_BASE, key: EMPTY, id: EMPTY };
  if (!(psk.key instanceof Uint8Array) || psk.key.length < MIN_PSK_BYTES)
    throw new Error("HPKE 预共享秘密太短。");
  if (!(psk.id instanceof Uint8Array) || psk.id.length === 0)
    throw new Error("HPKE 预共享秘密缺少标识。");
  return { mode: MODE_PSK, key: psk.key, id: psk.id };
}
/**
 * KeySchedule（第 5.1 节）：key_schedule_context = mode ‖ psk_id_hash ‖ info_hash，
 * secret = LabeledExtract(shared_secret, "secret", psk)，再展开 key 与 base_nonce。
 * 只做一次性封装，用不到 exporter_secret，也不维护序号：序号 0 时 nonce 就是 base_nonce。
 */
function keySchedule(
  sharedSecret: Uint8Array,
  info: Uint8Array,
  psk: ReturnType<typeof pskInputs>,
) {
  const pskIdHash = labeledExtract(HPKE_SUITE, EMPTY, "psk_id_hash", psk.id);
  const infoHash = labeledExtract(HPKE_SUITE, EMPTY, "info_hash", info);
  const context = concat(new Uint8Array([psk.mode]), pskIdHash, infoHash);
  const secret = labeledExtract(HPKE_SUITE, sharedSecret, "secret", psk.key);
  return {
    key: labeledExpand(HPKE_SUITE, secret, "key", context, N_KEY),
    nonce: labeledExpand(HPKE_SUITE, secret, "base_nonce", context, N_NONCE),
  };
}
/** 一次性封装：SetupBaseS／SetupPSKS 之后 Seal(aad, pt)，序号 0。给了 psk 就走 mode_psk。 */
export function hpkeSeal(opts: {
  recipientPublicKey: Uint8Array;
  info: Uint8Array;
  aad: Uint8Array;
  plaintext: Uint8Array;
  psk?: HpkePsk;
  ephemeralSecretKey?: Uint8Array;
  random?: (n: number) => Uint8Array;
}): HpkeSealed {
  const psk = pskInputs(opts.psk);
  const ephemeral =
    opts.ephemeralSecretKey ?? secretFrom(opts.random ?? getRandomBytes);
  const { enc, sharedSecret } = encap(opts.recipientPublicKey, ephemeral);
  const { key, nonce } = keySchedule(sharedSecret, opts.info, psk);
  const ct = chacha20poly1305(key, nonce, opts.aad).encrypt(opts.plaintext);
  return { enc, ct };
}
/** 一次性解封：SetupBaseR／SetupPSKR 之后 Open(aad, ct)，序号 0；任何一步不对都抛错。 */
export function hpkeOpen(opts: {
  recipientSecretKey: Uint8Array;
  enc: Uint8Array;
  info: Uint8Array;
  aad: Uint8Array;
  ct: Uint8Array;
  psk?: HpkePsk;
}): Uint8Array {
  const psk = pskInputs(opts.psk);
  if (opts.ct.length < TAG_BYTES) throw new Error("HPKE 密文太短。");
  const sharedSecret = decap(opts.enc, opts.recipientSecretKey);
  const { key, nonce } = keySchedule(sharedSecret, opts.info, psk);
  try {
    return chacha20poly1305(key, nonce, opts.aad).decrypt(opts.ct);
  } catch {
    throw new Error("HPKE 解封失败。");
  }
}
