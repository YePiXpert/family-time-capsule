import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { hpkeSeal, x25519KeyPair } from "../src/family/hpke";
import * as recovery from "../src/family/recovery";
import {
  bindingBytes,
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
} from "../src/family/recovery";
import {
  encKeyOf,
  fromBase64,
  keyIdOf,
  mnemonicOf,
  newMasterKey,
  objectIdOf,
  toBase64,
} from "../src/sync/crypto";

vi.mock("expo-crypto", () => ({
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
}));

const utf8 = (text: string) => new TextEncoder().encode(text);
const fixed = (seed: number) =>
  new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 13 + seed) & 255));
const WORDS_WRONG = "恢复码不对，请逐个词核对。";
const RECOVERY_WRONG = "恢复码打不开这个家庭的钥匙，请核对后再试。";
const PAIR_WRONG = "这份授权对不上，请让管理者重新扫码。";

describe("recovery words", () => {
  it("round-trips 12 words and tolerates spacing and case", () => {
    const r = newRecoverySecret();
    expect(r.length).toBe(16);
    const words = recoveryWordsOf(r);
    expect(words.split(" ")).toHaveLength(12);
    expect(recoveryFromWords(words)).toEqual(r);
    expect(
      recoveryFromWords(`  ${words.toUpperCase().split(" ").join("  \n ")} `),
    ).toEqual(r);
  });
  it("rejects wrong, missing, extra and all-zero words with one plain message", () => {
    const words = recoveryWordsOf(fixed(1)).split(" ");
    const swapped = [...words];
    swapped[3] = swapped[3] === "apple" ? "banana" : "apple";
    // 全零熵的合法 BIP39 词组：校验和对，但 R 不许全零。
    const zero = "abandon ".repeat(11) + "about";
    for (const bad of [
      swapped.join(" "),
      words.slice(0, 11).join(" "),
      [...words, "abandon"].join(" "),
      "",
      "not really words at all",
      zero,
    ])
      expect(() => recoveryFromWords(bad)).toThrow(WORDS_WRONG);
  });
  it("uses only injected randomness and refuses all-zero or short output", () => {
    expect(newRecoverySecret(() => fixed(5))).toEqual(fixed(5));
    expect(() => newRecoverySecret(() => new Uint8Array(16))).toThrow();
    expect(() => newRecoverySecret(() => new Uint8Array(15).fill(1))).toThrow();
  });
});

describe("recovery proof and verifier", () => {
  it("is deterministic, 32 bytes, and separated from the wrap key and K-derived values", () => {
    const r = fixed(1);
    const proof = recoveryProofOf(r);
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
    expect(recoveryProofOf(fixed(1))).toBe(proof);
    expect(recoveryProofOf(fixed(2))).not.toBe(proof);
    expect(proof).toBe(
      bytesToHex(hkdf(sha256, r, undefined, utf8("anan-recovery-auth-v1"), 32)),
    );
    const wrap = bytesToHex(
      hkdf(sha256, r, undefined, utf8("anan-recovery-wrap-v1"), 32),
    );
    expect(wrap).not.toBe(proof);
    // 即便 R 与 K 碰巧是同样的字节，各自派生出的东西也不相同。
    expect(proof).not.toBe(bytesToHex(encKeyOf(r)));
    expect(proof).not.toBe(objectIdOf(r, "ab".repeat(32), 0));
    expect(proof.slice(0, 16)).not.toBe(keyIdOf(r));
  });
  it("verifier is sha256 of the proof hex string, as the server computes it", () => {
    const proof = recoveryProofOf(fixed(3));
    expect(recoveryVerifierOf(proof)).toBe(bytesToHex(sha256(utf8(proof))));
    expect(recoveryVerifierOf(proof)).not.toBe(
      bytesToHex(sha256(hexToBytes(proof))),
    );
    expect(() => recoveryVerifierOf(proof.toUpperCase())).toThrow();
    expect(() => recoveryVerifierOf(proof.slice(1))).toThrow();
  });
});

describe("recovery envelope", () => {
  const r = fixed(1);
  const key = fixed(9);
  const ctx = { familyId: "fam-1", version: 2 };
  const openCtx = { ...ctx, keyId: keyIdOf(key) };
  it("wraps and unwraps K, in the documented byte layout", () => {
    const envelope = wrapContentKey(r, key, ctx);
    const bytes = fromBase64(envelope);
    expect(bytes.length).toBe(1 + 24 + 16 + 16);
    expect(bytes[0]).toBe(1);
    expect(unwrapContentKey(r, envelope, openCtx)).toEqual(key);
    // 独立按规格重算：wrap = HKDF(R, "anan-recovery-wrap-v1")，AAD 绑家庭、指纹、版本。
    const wrap = hkdf(sha256, r, undefined, utf8("anan-recovery-wrap-v1"), 32);
    const aad = utf8(`anan-recovery-v1|fam-1|${keyIdOf(key)}|2`);
    expect(
      xchacha20poly1305(wrap, bytes.subarray(1, 25), aad).decrypt(
        bytes.subarray(25),
      ),
    ).toEqual(key);
  });
  it("draws the nonce from the injected random source", () => {
    const nonce = new Uint8Array(24).fill(7);
    const a = wrapContentKey(r, key, ctx, () => nonce);
    expect(fromBase64(a).subarray(1, 25)).toEqual(nonce);
    expect(wrapContentKey(r, key, ctx, () => nonce)).toBe(a);
    expect(wrapContentKey(r, key, ctx)).not.toBe(a);
  });
  it("refuses a wrong R, family, version, key id or a tampered envelope", () => {
    const envelope = wrapContentKey(r, key, ctx);
    const bytes = fromBase64(envelope);
    const flipped = bytes.slice();
    flipped[30] = flipped[30]! ^ 1;
    const badVersion = bytes.slice();
    badVersion[0] = 2;
    const cases: [Uint8Array, string, typeof openCtx][] = [
      [fixed(2), envelope, openCtx],
      [r, envelope, { ...openCtx, familyId: "fam-2" }],
      [r, envelope, { ...openCtx, version: 3 }],
      [r, envelope, { ...openCtx, keyId: keyIdOf(fixed(10)) }],
      [r, "not base64!", openCtx],
      [r, wrapContentKey(r, key, ctx).slice(0, 40), openCtx],
    ];
    for (const [rr, env, c] of cases)
      expect(() => unwrapContentKey(rr, env, c)).toThrow(RECOVERY_WRONG);
    for (const b of [flipped, badVersion])
      expect(() =>
        unwrapContentKey(r, toBase64(b), openCtx),
      ).toThrow(RECOVERY_WRONG);
  });
  it("R and K are independent: nothing in the recovery module turns K into words", () => {
    const k = newMasterKey();
    const rr = newRecoverySecret();
    expect(recoveryWordsOf(rr)).not.toBe(mnemonicOf(k));
    expect(Object.keys(recovery).sort()).toEqual(
      [
        "PAIR_PAYLOAD_V1",
        "RECOVERY_BYTES",
        "RECOVERY_ENVELOPE_V1",
        "bindingBytes",
        "fromBase64Url",
        "newRecoverySecret",
        "openContentKeyForDevice",
        "recoveryFromWords",
        "recoveryProofOf",
        "recoveryVerifierOf",
        "recoveryWordsOf",
        "sealContentKeyForDevice",
        "toBase64Url",
        "unwrapContentKey",
        "wrapContentKey",
      ].sort(),
    );
    // 唯一接收 K 的导出只产出密文（恢复包／钥匙包），而且每次都带随机。
    expect(wrapContentKey(rr, k, { familyId: "f", version: 1 })).not.toBe(
      wrapContentKey(rr, k, { familyId: "f", version: 1 }),
    );
  });
});

describe("device key package", () => {
  const key = fixed(9);
  const binding: PairBinding = {
    familyId: "fam-1",
    requestId: "req-1",
    memberId: "mem-1",
    role: "member",
    deviceId: "dev-2",
    deviceName: "妈妈的手机",
    approverDeviceId: "dev-1",
    keyId: keyIdOf(key),
    expiresAt: "2026-09-25T00:00:00.000Z",
  };
  const device = x25519KeyPair();
  const psk = new Uint8Array(randomBytes(32));
  const sealed = sealContentKeyForDevice({
    recipientPublicKey: device.publicKey,
    psk,
    binding,
    key,
  });
  const open = (over: Partial<Parameters<typeof openContentKeyForDevice>[0]> = {}) =>
    openContentKeyForDevice({
      secretKey: device.secretKey,
      psk,
      binding,
      ...sealed,
      ...over,
    });
  it("round-trips K to the new phone as base64url without padding", () => {
    expect(sealed.enc).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sealed.ct).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(sealed.enc)).toHaveLength(32);
    expect(open()).toEqual(key);
  });
  it("binding bytes are a fixed-order JSON array", () => {
    expect(new TextDecoder().decode(bindingBytes(binding))).toBe(
      JSON.stringify([
        "anan-pair-v1",
        "fam-1",
        "req-1",
        "mem-1",
        "member",
        "dev-2",
        "妈妈的手机",
        "dev-1",
        keyIdOf(key),
        "2026-09-25T00:00:00.000Z",
      ]),
    );
  });
  it("a package the server forges without the QR secret does not open", () => {
    const forged = sealContentKeyForDevice({
      recipientPublicKey: device.publicKey,
      psk: new Uint8Array(randomBytes(32)),
      binding,
      key,
    });
    expect(() => open(forged)).toThrow(PAIR_WRONG);
    expect(() => open({ psk: new Uint8Array(randomBytes(32)) })).toThrow(
      PAIR_WRONG,
    );
    expect(() => open({ psk: psk.subarray(0, 31) })).toThrow(PAIR_WRONG);
    expect(() => open({ secretKey: x25519KeyPair().secretKey })).toThrow(
      PAIR_WRONG,
    );
  });
  it("any single binding field changed makes it fail", () => {
    const changes: Partial<PairBinding>[] = [
      { familyId: "fam-2" },
      { requestId: "req-2" },
      { memberId: "mem-2" },
      { role: "admin" },
      { deviceId: "dev-3" },
      { deviceName: "爸爸的手机" },
      { approverDeviceId: "dev-9" },
      { keyId: keyIdOf(fixed(10)) },
      { expiresAt: "2026-09-26T00:00:00.000Z" },
    ];
    for (const change of changes)
      expect(() => open({ binding: { ...binding, ...change } })).toThrow(
        PAIR_WRONG,
      );
  });
  it("rejects tampered or malformed enc/ct", () => {
    const ct = fromBase64Url(sealed.ct);
    ct[0] = ct[0]! ^ 1;
    expect(() => open({ ct: toBase64Url(ct) })).toThrow(PAIR_WRONG);
    expect(() => open({ ct: sealed.ct + "=" })).toThrow(PAIR_WRONG);
    expect(() => open({ enc: sealed.enc.replace(/^./, "+") })).toThrow(
      PAIR_WRONG,
    );
  });
  // 绕过 sealContentKeyForDevice 的自检，直接用 HPKE 封出内容不合规矩的包。
  const rawSeal = (payload: unknown) => {
    const s = hpkeSeal({
      recipientPublicKey: device.publicKey,
      info: utf8(`anan-pair-v1|${binding.familyId}|${binding.requestId}`),
      aad: bindingBytes(binding),
      plaintext: utf8(JSON.stringify(payload)),
      psk: { key: psk, id: utf8("anan-pair-psk-v1") },
    });
    return { enc: toBase64Url(s.enc), ct: toBase64Url(s.ct) };
  };
  it("accepts a well-formed raw package (sanity check for the cases below)", () => {
    expect(
      open(rawSeal({ v: 1, key: bytesToHex(key), familyId: "fam-1" })),
    ).toEqual(key);
  });
  it("rejects a key whose fingerprint does not match the binding, and bad payloads", () => {
    for (const payload of [
      { v: 1, key: bytesToHex(fixed(10)), familyId: "fam-1" },
      { v: 2, key: bytesToHex(key), familyId: "fam-1" },
      { v: 1, key: bytesToHex(key), familyId: "fam-2" },
      { v: 1, key: bytesToHex(key).toUpperCase(), familyId: "fam-1" },
      { v: 1, key: bytesToHex(randomBytes(32)), familyId: "fam-1" },
      { v: 1, familyId: "fam-1" },
      "just a string",
      null,
    ])
      expect(() => open(rawSeal(payload))).toThrow(PAIR_WRONG);
  });
  it("the sealer refuses a key that does not match the binding or a short QR secret", () => {
    expect(() =>
      sealContentKeyForDevice({
        recipientPublicKey: device.publicKey,
        psk,
        binding,
        key: fixed(10),
      }),
    ).toThrow();
    expect(() =>
      sealContentKeyForDevice({
        recipientPublicKey: device.publicKey,
        psk: psk.subarray(0, 16),
        binding,
        key,
      }),
    ).toThrow();
  });
  it("uses injected randomness for the ephemeral key", () => {
    const eph = new Uint8Array(32).fill(3);
    const a = sealContentKeyForDevice({
      recipientPublicKey: device.publicKey,
      psk,
      binding,
      key,
      random: () => eph,
    });
    const b = sealContentKeyForDevice({
      recipientPublicKey: device.publicKey,
      psk,
      binding,
      key,
      random: () => eph,
    });
    expect(a).toEqual(b);
    expect(open(a)).toEqual(key);
  });
});

describe("base64url", () => {
  it("round-trips every length without padding", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(randomBytes(n));
      const text = toBase64Url(bytes);
      expect(text).not.toMatch(/[=+/]/);
      expect(fromBase64Url(text)).toEqual(bytes);
    }
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });
  it("rejects invalid characters, padding, impossible lengths and non-zero trailing bits", () => {
    for (const bad of ["ab+c", "ab/c", "abc=", "a", "abcde", "ab c", "-_9"])
      expect(() => fromBase64Url(bad)).toThrow();
  });
});
