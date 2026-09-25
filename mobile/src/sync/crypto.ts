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
import { CHUNKS_PER_OBJECT } from "./planner";
/**
 * 远端备份的零知识层。主密钥 K 是 16 字节的家庭内容钥匙：1.1.0 起它与恢复码相互独立，
 * 只在获准的手机之间封装传递（见 family/recovery.ts）；1.0.8 及以前 K 本身就是 12 词恢复码，
 * mnemonicOf／keyFromMnemonic 是那时留下的换算，现在只有测试在用。
 *
 * 一切随机都来自 expo-crypto：Hermes 没有 crypto.getRandomValues，noble／scure 自带的随机函数
 * 在真机上会直接抛错，所以这里连 nonce 都不随机——按内容派生：
 *   对象 id   = HKDF(K, "anan-objid-v1/<素材sha256>/<part>")          32 字节 → hex
 *   加密子钥  = HKDF(K, "anan-backup-v1/enc")                          32 字节
 *   nonce     = HKDF(K, "anan-nonce-v1/<素材sha256>")(20 字节) ‖ u32be(全局块序)
 * 同一把钥匙、同一份内容永远得到同样的密文与 id（重装、断点续传、Build 71 的第二台设备都算得出），
 * 不同内容不会撞 nonce（除非 sha256 碰撞）。服务端只见对象 id 与密文长度，见不到照片哈希。
 */
export const KEY_BYTES = 16;
export const ALG_XCHACHA20_POLY1305 = 1;
const OBJECT_MAGIC = "ANANOBJ1";
const SMALL_MAGIC = "ANANSML1";
/** 对象头：魔数 8 ‖ alg 1 ‖ keyId 8 ‖ objectId 32 ‖ 块数 4 ‖ 末块标志 1。 */
export const OBJECT_HEADER_BYTES = 8 + 1 + 8 + 32 + 4 + 1;
const TAG_BYTES = 16;
const utf8 = (text: string) => new TextEncoder().encode(text);
const u32 = (n: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
/** 生成主密钥：只从 expo-crypto 取随机字节。 */
export function newMasterKey(
  random: (bytes: number) => Uint8Array = getRandomBytes,
): Uint8Array {
  const key = random(KEY_BYTES);
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES)
    throw new Error("生成钥匙失败。");
  if (key.every((b) => b === 0)) throw new Error("生成钥匙失败。");
  return key;
}
export const keyToHex = (key: Uint8Array) => bytesToHex(key);
export function keyFromHex(hex: string): Uint8Array {
  const key = hexToBytes(hex);
  if (key.length !== KEY_BYTES) throw new Error("钥匙格式不对。");
  return key;
}
/** 钥匙指纹：sha256(K) 前 16 个 hex。随远端数据存，换错恢复码在下载前就能判出。 */
export const keyIdOf = (key: Uint8Array) =>
  bytesToHex(sha256(key)).slice(0, 16);
const derive = (key: Uint8Array, info: string, length: number) =>
  hkdf(sha256, key, undefined, utf8(info), length);
export const encKeyOf = (key: Uint8Array) =>
  derive(key, "anan-backup-v1/enc", 32);
export const noncePrefixOf = (key: Uint8Array, contentSha256: string) =>
  derive(key, `anan-nonce-v1/${contentSha256}`, 20);
/**
 * 对象 id 只由钥匙和内容定，每次推送都要给每个素材的每一块算一遍 HKDF（一万个素材在手机上要几秒）：
 * 按钥匙指纹记住算过的。表里只有 id，没有钥匙；换钥匙就是另一张表。
 */
const objectIds = new Map<string, Map<string, string>>();
const keyIds = new WeakMap<Uint8Array, string>();
export function objectIdOf(
  key: Uint8Array,
  contentSha256: string,
  part: number,
): string {
  let keyId = keyIds.get(key);
  if (keyId === undefined) keyIds.set(key, (keyId = keyIdOf(key)));
  let ids = objectIds.get(keyId);
  if (!ids) {
    objectIds.clear();
    objectIds.set(keyId, (ids = new Map()));
  }
  const label = `${contentSha256}/${part}`;
  let id = ids.get(label);
  if (id === undefined) {
    id = bytesToHex(derive(key, `anan-objid-v1/${label}`, 32));
    if (ids.size >= 200000) ids.clear();
    ids.set(label, id);
  }
  return id;
}
/** 12 个英文词；抄在纸上就是整份远端备份的钥匙。 */
export const mnemonicOf = (key: Uint8Array) => entropyToMnemonic(key, wordlist);
/** 规整空白与大小写后校验；错一个词、少一个词、校验和不对都只说一句人话。 */
export function keyFromMnemonic(words: string): Uint8Array {
  const normalized = words.trim().toLowerCase().split(/\s+/).join(" ");
  if (!normalized || !validateMnemonic(normalized, wordlist))
    throw new Error("恢复码不对，请逐个词核对。");
  const key = mnemonicToEntropy(normalized, wordlist);
  if (key.length !== KEY_BYTES) throw new Error("恢复码不对，请逐个词核对。");
  return key;
}
export type ObjectRef = {
  /** 明文内容（素材或清单）的 sha256，只出现在手机与加密清单里。 */
  sha256: string;
  part: number;
  /** 这是该内容的最后一个对象。 */
  final: boolean;
};
function chunkNonce(key: Uint8Array, ref: ObjectRef, index: number) {
  return concat(
    noncePrefixOf(key, ref.sha256),
    u32(ref.part * CHUNKS_PER_OBJECT + index),
  );
}
function objectHeader(key: Uint8Array, ref: ObjectRef, chunks: number) {
  return concat(
    utf8(OBJECT_MAGIC),
    new Uint8Array([ALG_XCHACHA20_POLY1305]),
    hexToBytes(keyIdOf(key)),
    hexToBytes(objectIdOf(key, ref.sha256, ref.part)),
    u32(chunks),
    new Uint8Array([ref.final ? 1 : 0]),
  );
}
/**
 * 把一个对象的明文块封成密文：头部 ‖ [长度 4 ‖ 密文]×n。每块的 AAD 是整个头部加块序，
 * 改头、换块、少块、把别的对象的块接过来，解开时都会在那一块上失败。
 */
export function sealObject(
  key: Uint8Array,
  ref: ObjectRef,
  chunks: readonly Uint8Array[],
): Uint8Array {
  if (!chunks.length || chunks.length > CHUNKS_PER_OBJECT)
    throw new Error("对象块数不对。");
  const enc = encKeyOf(key);
  const header = objectHeader(key, ref, chunks.length);
  const parts = [header];
  chunks.forEach((plain, i) => {
    if (!plain.length) throw new Error("对象块数不对。");
    const aad = concat(header, u32(i));
    const ct = xchacha20poly1305(enc, chunkNonce(key, ref, i), aad).encrypt(
      plain,
    );
    parts.push(u32(ct.length), ct);
  });
  return concat(...parts);
}
/** 解开一个对象；头部与预期的 ref 不符或任一块被动过，都报「这一份对不上」。 */
export function openObject(
  key: Uint8Array,
  ref: ObjectRef,
  bytes: Uint8Array,
): Uint8Array[] {
  const broken = () => new Error("远端这一份对不上，可能被改动过。");
  if (bytes.length < OBJECT_HEADER_BYTES) throw broken();
  const header = bytes.subarray(0, OBJECT_HEADER_BYTES);
  const count = new DataView(
    header.buffer,
    header.byteOffset + 8 + 1 + 8 + 32,
    4,
  ).getUint32(0);
  if (
    !same(header, objectHeader(key, ref, count)) ||
    count < 1 ||
    count > CHUNKS_PER_OBJECT
  )
    throw broken();
  const enc = encKeyOf(key);
  const chunks: Uint8Array[] = [];
  let at = OBJECT_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    if (at + 4 > bytes.length) throw broken();
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + at,
      4,
    ).getUint32(0);
    at += 4;
    if (length <= TAG_BYTES || at + length > bytes.length) throw broken();
    const ct = bytes.subarray(at, at + length);
    at += length;
    try {
      chunks.push(
        xchacha20poly1305(
          enc,
          chunkNonce(key, ref, i),
          concat(header, u32(i)),
        ).decrypt(ct),
      );
    } catch {
      throw broken();
    }
  }
  if (at !== bytes.length) throw broken();
  return chunks;
}
/**
 * 小件（清单索引，< 64 KiB）：nonce 由内容哈希与钥匙一起派生，同样不需要随机数；
 * 格式 魔数 8 ‖ 密文。AAD 绑标签，索引不能被拿去冒充别的东西。
 */
export function sealSmall(
  key: Uint8Array,
  label: string,
  plain: Uint8Array,
): Uint8Array {
  const nonce = derive(
    key,
    `anan-small-v1/${label}/${bytesToHex(sha256(plain))}`,
    24,
  );
  const ct = xchacha20poly1305(encKeyOf(key), nonce, utf8(label)).encrypt(
    plain,
  );
  return concat(utf8(SMALL_MAGIC), nonce, ct);
}
export function openSmall(
  key: Uint8Array,
  label: string,
  bytes: Uint8Array,
): Uint8Array {
  const broken = () => new Error("远端索引对不上，可能被改动过。");
  if (
    bytes.length < 8 + 24 + TAG_BYTES ||
    !same(bytes.subarray(0, 8), utf8(SMALL_MAGIC))
  )
    throw broken();
  try {
    return xchacha20poly1305(
      encKeyOf(key),
      bytes.subarray(8, 32),
      utf8(label),
    ).decrypt(bytes.subarray(32));
  } catch {
    throw broken();
  }
}
export const sha256Hex = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Hermes 不保证有 btoa／atob，自己写一份标准 base64。 */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!,
      b = bytes[i + 1],
      c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += b === undefined ? "=" : B64[(n >> 6) & 63]!;
    out += c === undefined ? "=" : B64[n & 63]!;
  }
  return out;
}
export function fromBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4)
    throw new Error("base64 格式不对。");
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0,
    buffer = 0,
    at = 0;
  for (const ch of clean) {
    buffer = (buffer << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (buffer >> bits) & 255;
    }
  }
  return out;
}
