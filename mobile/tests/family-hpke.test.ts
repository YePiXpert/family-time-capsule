import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { hpkeOpen, hpkeSeal, x25519KeyPair } from "../src/family/hpke";

vi.mock("expo-crypto", () => ({
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
}));

const h = (hex: string) => hexToBytes(hex.replace(/\s+/g, ""));

/**
 * RFC 9180 附录 A.2：DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20Poly1305。
 * 逐字抄自 RFC 正文（A.2.1 Base Setup Information／A.2.1.1 Encryptions 与
 * A.2.2 PSK Setup Information／A.2.2.1 Encryptions，各取 sequence number: 0）。
 */
const BASE = {
  info: "4f6465206f6e2061204772656369616e2055726e",
  pkEm: "1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a",
  skEm: "f4ec9b33b792c372c1d2c2063507b684ef925b8c75a42dbcbf57d63ccd381600",
  pkRm: "4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a",
  skRm: "8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb",
  enc: "1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a",
  pt: "4265617574792069732074727574682c20747275746820626561757479",
  aad: "436f756e742d30",
  ct:
    "1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db" +
    "21993c62ce81883d2dd1b51a28",
};
const PSK = {
  info: "4f6465206f6e2061204772656369616e2055726e",
  pkEm: "2261299c3f40a9afc133b969a97f05e95be2c514e54f3de26cbe5644ac735b04",
  skEm: "0c35fdf49df7aa01cd330049332c40411ebba36e0c718ebc3edf5845795f6321",
  pkRm: "13640af826b722fc04feaa4de2f28fbd5ecc03623b317834e7ff4120dbe73062",
  skRm: "77d114e0212be51cb1d76fa99dd41cfd4d0166b08caa09074430a6c59ef17879",
  psk: "0247fd33b913760fa1fa51e1892d9f307fbe65eb171e8132c2af18555a738b82",
  psk_id: "456e6e796e20447572696e206172616e204d6f726961",
  enc: "2261299c3f40a9afc133b969a97f05e95be2c514e54f3de26cbe5644ac735b04",
  pt: "4265617574792069732074727574682c20747275746820626561757479",
  aad: "436f756e742d30",
  ct:
    "4a177f9c0d6f15cfdf533fb65bf84aecdc6ab16b8b85b4cf65a370e07fc1d78d" +
    "28fb073214525276f4a89608ff",
};
const pskOf = (v: typeof PSK) => ({ key: h(v.psk), id: h(v.psk_id) });

describe("RFC 9180 A.2.1 Base", () => {
  it("reproduces enc and ct with the vector's ephemeral key, and opens them", () => {
    const sealed = hpkeSeal({
      recipientPublicKey: h(BASE.pkRm),
      info: h(BASE.info),
      aad: h(BASE.aad),
      plaintext: h(BASE.pt),
      ephemeralSecretKey: h(BASE.skEm),
    });
    expect(bytesToHex(sealed.enc)).toBe(BASE.enc);
    expect(bytesToHex(sealed.enc)).toBe(BASE.pkEm);
    expect(bytesToHex(sealed.ct)).toBe(BASE.ct);
    const pt = hpkeOpen({
      recipientSecretKey: h(BASE.skRm),
      enc: h(BASE.enc),
      info: h(BASE.info),
      aad: h(BASE.aad),
      ct: h(BASE.ct),
    });
    expect(bytesToHex(pt)).toBe(BASE.pt);
  });
  it("key pairs derive the vector's public keys", () => {
    expect(bytesToHex(x25519KeyPair(() => h(BASE.skRm)).publicKey)).toBe(
      BASE.pkRm,
    );
    expect(bytesToHex(x25519KeyPair(() => h(BASE.skEm)).publicKey)).toBe(
      BASE.pkEm,
    );
  });
  it("base-mode ciphertext does not open in psk mode", () => {
    expect(() =>
      hpkeOpen({
        recipientSecretKey: h(BASE.skRm),
        enc: h(BASE.enc),
        info: h(BASE.info),
        aad: h(BASE.aad),
        ct: h(BASE.ct),
        psk: pskOf(PSK),
      }),
    ).toThrow();
  });
});

describe("RFC 9180 A.2.2 PSK", () => {
  const open = (over: Partial<Parameters<typeof hpkeOpen>[0]> = {}) =>
    hpkeOpen({
      recipientSecretKey: h(PSK.skRm),
      enc: h(PSK.enc),
      info: h(PSK.info),
      aad: h(PSK.aad),
      ct: h(PSK.ct),
      psk: pskOf(PSK),
      ...over,
    });
  it("reproduces enc and ct with the vector's ephemeral key, and opens them", () => {
    const sealed = hpkeSeal({
      recipientPublicKey: h(PSK.pkRm),
      info: h(PSK.info),
      aad: h(PSK.aad),
      plaintext: h(PSK.pt),
      psk: pskOf(PSK),
      ephemeralSecretKey: h(PSK.skEm),
    });
    expect(bytesToHex(sealed.enc)).toBe(PSK.enc);
    expect(bytesToHex(sealed.ct)).toBe(PSK.ct);
    expect(bytesToHex(open())).toBe(PSK.pt);
  });
  const flip = (bytes: Uint8Array, at = 0) => {
    const out = bytes.slice();
    out[at] = out[at]! ^ 1;
    return out;
  };
  it("rejects tampered enc, ct, aad and info", () => {
    expect(() => open({ enc: flip(h(PSK.enc)) })).toThrow();
    expect(() => open({ enc: h(PSK.enc).subarray(1) })).toThrow();
    expect(() => open({ ct: flip(h(PSK.ct)) })).toThrow();
    expect(() => open({ ct: flip(h(PSK.ct), h(PSK.ct).length - 1) })).toThrow();
    expect(() => open({ ct: h(PSK.ct).subarray(0, 10) })).toThrow();
    expect(() => open({ aad: flip(h(PSK.aad)) })).toThrow();
    expect(() => open({ aad: new Uint8Array(0) })).toThrow();
    expect(() => open({ info: flip(h(PSK.info)) })).toThrow();
  });
  it("rejects a wrong psk, a wrong psk id, a missing psk and a wrong recipient", () => {
    expect(() =>
      open({ psk: { key: flip(h(PSK.psk)), id: h(PSK.psk_id) } }),
    ).toThrow();
    expect(() =>
      open({ psk: { key: h(PSK.psk), id: flip(h(PSK.psk_id)) } }),
    ).toThrow();
    expect(() => open({ psk: undefined })).toThrow();
    expect(() => open({ recipientSecretKey: h(BASE.skRm) })).toThrow();
  });
  it("refuses a psk shorter than 32 bytes or an empty psk id, on both sides", () => {
    const short = { key: h(PSK.psk).subarray(0, 31), id: h(PSK.psk_id) };
    const noId = { key: h(PSK.psk), id: new Uint8Array(0) };
    for (const psk of [short, noId]) {
      expect(() =>
        hpkeSeal({
          recipientPublicKey: h(PSK.pkRm),
          info: h(PSK.info),
          aad: h(PSK.aad),
          plaintext: h(PSK.pt),
          psk,
        }),
      ).toThrow();
      expect(() => open({ psk })).toThrow();
    }
  });
});

describe("hpkeSeal with fresh keys", () => {
  it("uses injected randomness for the ephemeral key and round-trips", () => {
    const recipient = x25519KeyPair();
    const psk = { key: new Uint8Array(randomBytes(32)), id: new Uint8Array([7]) };
    const calls: number[] = [];
    const random = (n: number) => {
      calls.push(n);
      return new Uint8Array(randomBytes(n));
    };
    const msg = new TextEncoder().encode("钥匙");
    const aad = new Uint8Array([1, 2, 3]);
    const info = new Uint8Array([4]);
    const sealed = hpkeSeal({
      recipientPublicKey: recipient.publicKey,
      info,
      aad,
      plaintext: msg,
      psk,
      random,
    });
    expect(calls).toEqual([32]);
    expect(sealed.enc.length).toBe(32);
    expect(sealed.ct.length).toBe(msg.length + 16);
    expect(
      hpkeOpen({
        recipientSecretKey: recipient.secretKey,
        enc: sealed.enc,
        info,
        aad,
        ct: sealed.ct,
        psk,
      }),
    ).toEqual(msg);
  });
  it("refuses all-zero or short secret keys and low-order public keys", () => {
    expect(() => x25519KeyPair(() => new Uint8Array(32))).toThrow();
    expect(() => x25519KeyPair(() => new Uint8Array(16).fill(1))).toThrow();
    const lowOrder = [
      new Uint8Array(32), // 0
      (() => {
        const p = new Uint8Array(32);
        p[0] = 1;
        return p;
      })(), // 1
    ];
    for (const pk of lowOrder)
      expect(() =>
        hpkeSeal({
          recipientPublicKey: pk,
          info: new Uint8Array(0),
          aad: new Uint8Array(0),
          plaintext: new Uint8Array([1]),
        }),
      ).toThrow();
    const me = x25519KeyPair();
    for (const enc of lowOrder)
      expect(() =>
        hpkeOpen({
          recipientSecretKey: me.secretKey,
          enc,
          info: new Uint8Array(0),
          aad: new Uint8Array(0),
          ct: new Uint8Array(17),
        }),
      ).toThrow();
  });
});
