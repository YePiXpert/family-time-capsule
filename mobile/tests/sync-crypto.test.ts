import { expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  CHUNKS_PER_OBJECT,
  KEY_BYTES,
  OBJECT_HEADER_BYTES,
  fromBase64,
  keyFromHex,
  keyFromMnemonic,
  keyIdOf,
  keyToHex,
  mnemonicOf,
  newMasterKey,
  objectIdOf,
  openObject,
  openSmall,
  sealObject,
  sealSmall,
  sha256Hex,
  toBase64,
} from "../src/sync/crypto";
vi.mock("expo-crypto", () => ({
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
}));
const fixedKey = () =>
  new Uint8Array(Array.from({ length: 16 }, (_, i) => i * 7 + 1));
const ref = { sha256: "ab".repeat(32), part: 2, final: true };
const chunks = [
  new Uint8Array(1000).fill(1),
  new Uint8Array(20).fill(2),
  new Uint8Array([9]),
];
it("seals and opens an object, and the output is identical for the same key and content", () => {
  const key = fixedKey();
  const sealed = sealObject(key, ref, chunks);
  expect(sealed.length).toBe(
    OBJECT_HEADER_BYTES + chunks.reduce((n, c) => n + 4 + c.length + 16, 0),
  );
  expect(new TextDecoder().decode(sealed.subarray(0, 8))).toBe("ANANOBJ1");
  expect(openObject(key, ref, sealed)).toEqual(chunks);
  expect(sealObject(key, ref, chunks)).toEqual(sealed);
  // 明文哈希不在密文里，服务端拿着密文猜不出是哪张照片。
  expect(Buffer.from(sealed).includes(Buffer.from(ref.sha256, "hex"))).toBe(
    false,
  );
  expect(
    Buffer.from(sealed).includes(
      Buffer.from(objectIdOf(key, ref.sha256, ref.part), "hex"),
    ),
  ).toBe(true);
});
it("rejects any flipped byte, a swapped chunk order, the wrong ref and the wrong key", () => {
  const key = fixedKey();
  const sealed = sealObject(key, ref, chunks);
  for (const at of [
    0,
    8,
    9,
    20,
    50,
    OBJECT_HEADER_BYTES + 3,
    OBJECT_HEADER_BYTES + 4,
    sealed.length - 1,
  ]) {
    const copy = new Uint8Array(sealed);
    copy[at]! ^= 1;
    expect(() => openObject(key, ref, copy)).toThrow("对不上");
  }
  expect(() =>
    openObject(key, ref, sealed.subarray(0, sealed.length - 1)),
  ).toThrow("对不上");
  expect(() => openObject(key, { ...ref, part: 1 }, sealed)).toThrow("对不上");
  expect(() => openObject(key, { ...ref, final: false }, sealed)).toThrow(
    "对不上",
  );
  expect(() => openObject(new Uint8Array(16).fill(3), ref, sealed)).toThrow(
    "对不上",
  );
  // 两块对调：每块的 AAD 都绑着块序。
  const a = sealObject(key, ref, [chunks[0]!, chunks[1]!]);
  const b = sealObject(key, ref, [chunks[1]!, chunks[0]!]);
  expect(a).not.toEqual(b);
  expect(() => sealObject(key, ref, [])).toThrow("块数");
  expect(() =>
    sealObject(key, ref, Array(CHUNKS_PER_OBJECT + 1).fill(chunks[2])),
  ).toThrow("块数");
});
it("derives different object ids per key, content and part, and a stable key id", () => {
  const k1 = fixedKey(),
    k2 = new Uint8Array(16).fill(5);
  const sha = "cd".repeat(32);
  expect(objectIdOf(k1, sha, 0)).toMatch(/^[a-f0-9]{64}$/);
  expect(objectIdOf(k1, sha, 0)).not.toBe(objectIdOf(k2, sha, 0));
  expect(objectIdOf(k1, sha, 0)).not.toBe(objectIdOf(k1, sha, 1));
  expect(objectIdOf(k1, sha, 0)).not.toBe(objectIdOf(k1, "ef".repeat(32), 0));
  expect(keyIdOf(k1)).toMatch(/^[a-f0-9]{16}$/);
  expect(keyIdOf(k1)).toBe(keyIdOf(fixedKey()));
  expect(keyIdOf(k1)).not.toBe(keyIdOf(k2));
});
it("round-trips the key through 12 words and rejects a wrong word, spacing aside", () => {
  const key = newMasterKey();
  expect(key).toHaveLength(KEY_BYTES);
  const words = mnemonicOf(key);
  expect(words.split(" ")).toHaveLength(12);
  expect(keyFromMnemonic(words)).toEqual(key);
  expect(
    keyFromMnemonic(`  ${words.toUpperCase().replace(/ /g, "\n  ")} `),
  ).toEqual(key);
  const list = words.split(" ");
  // 词表外的词一定被拒；换成词表里的另一个词，4 位校验和只能挡住十六分之十五，
  // 但就算侥幸通过，得到的也是另一把钥匙，解不开远端——不会静默装作同一把。
  expect(() =>
    keyFromMnemonic([...list.slice(0, 3), "zzzz", ...list.slice(4)].join(" ")),
  ).toThrow("恢复码不对");
  const swapped = [
    ...list.slice(0, 3),
    list[3] === "zoo" ? "abandon" : "zoo",
    ...list.slice(4),
  ].join(" ");
  let other: Uint8Array | null = null;
  try {
    other = keyFromMnemonic(swapped);
  } catch (e) {
    expect(String(e)).toContain("恢复码不对");
  }
  if (other) expect(other).not.toEqual(key);
  expect(() => keyFromMnemonic(list.slice(0, 11).join(" "))).toThrow(
    "恢复码不对",
  );
  expect(() => keyFromMnemonic("")).toThrow("恢复码不对");
  expect(keyFromHex(keyToHex(key))).toEqual(key);
  expect(() => keyFromHex("abcd")).toThrow("钥匙格式");
  // 主密钥只从注入的随机源来；全零视为随机源坏了。
  expect(() => newMasterKey(() => new Uint8Array(16))).toThrow("生成钥匙失败");
  expect(() => newMasterKey(() => new Uint8Array(8).fill(1))).toThrow(
    "生成钥匙失败",
  );
});
it("seals a small index bound to its label and refuses tampering or another label", () => {
  const key = fixedKey();
  const plain = new TextEncoder().encode(JSON.stringify({ v: 1, parts: 3 }));
  const sealed = sealSmall(key, "anan-index-v1", plain);
  expect(openSmall(key, "anan-index-v1", sealed)).toEqual(plain);
  expect(sealSmall(key, "anan-index-v1", plain)).toEqual(sealed);
  expect(() => openSmall(key, "other", sealed)).toThrow("对不上");
  const copy = new Uint8Array(sealed);
  copy[copy.length - 1]! ^= 1;
  expect(() => openSmall(key, "anan-index-v1", copy)).toThrow("对不上");
  expect(() =>
    openSmall(new Uint8Array(16).fill(9), "anan-index-v1", sealed),
  ).toThrow("对不上");
});
it("encodes base64 without btoa and rejects malformed input", () => {
  for (const n of [0, 1, 2, 3, 4, 57, 1000]) {
    const bytes = new Uint8Array(randomBytes(n));
    const text = toBase64(bytes);
    expect(text).toBe(Buffer.from(bytes).toString("base64"));
    expect(fromBase64(text)).toEqual(bytes);
  }
  expect(() => fromBase64("abc")).toThrow("base64");
  expect(() => fromBase64("ab$d")).toThrow("base64");
  expect(sha256Hex(new Uint8Array(0))).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});
it("reports how fast Node seals 64 MiB (real-device speed goes in HANDOFF)", () => {
  const key = fixedKey();
  const chunk = new Uint8Array(1 << 20).fill(7);
  const started = performance.now();
  let bytes = 0;
  for (let part = 0; part < 16; part++) {
    const sealed = sealObject(
      key,
      { sha256: "11".repeat(32), part, final: part === 15 },
      [chunk, chunk, chunk, chunk],
    );
    bytes += sealed.length;
  }
  const seconds = (performance.now() - started) / 1000;
  console.log(
    `xchacha20-poly1305 seal: ${(bytes / 1048576 / seconds).toFixed(0)} MB/s in Node`,
  );
  expect(bytes).toBeGreaterThan(64 * 1048576);
});
