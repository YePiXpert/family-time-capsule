import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";

/**
 * 合成 WebAuthn 认证器（测试专用）：
 * 手工构造 "none" attestation 的注册响应与 ES256 断言，走 @simplewebauthn/server
 * 的完整校验路径（CBOR/COSE/签名/counter），不需要浏览器。
 */

export function toBase64Url(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

// ---- 极小 CBOR 编码器（仅覆盖本测试需要的固定形状） ----

function cborHead(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length <= 0xff) return Buffer.from([(major << 5) | 24, length]);
  if (length <= 0xffff) {
    return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
  }
  throw new Error("cbor length out of supported range");
}

export function cborBytes(bytes: Buffer): Buffer {
  return Buffer.concat([cborHead(2, bytes.length), bytes]);
}

export function cborText(text: string): Buffer {
  return Buffer.concat([cborHead(3, text.length), Buffer.from(text, "utf8")]);
}

export function cborUint(value: number): Buffer {
  return cborHead(0, value);
}

export function cborNint(value: number): Buffer {
  return cborHead(1, -value - 1);
}

export function cborMap(entries: Buffer[]): Buffer {
  return Buffer.concat([cborHead(5, entries.length / 2), ...entries]);
}

// ---- ES256 凭据 ----

export type SyntheticCredential = {
  credentialId: Buffer;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  publicKeyJwk: { x: string; y: string };
};

export function createCredential(): SyntheticCredential {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  return { credentialId: randomBytes(32), privateKey, publicKeyJwk: jwk };
}

/** COSE ES256 公钥（kty 2 / alg -7 / crv 1 / x / y）。 */
export function coseKey(jwk: { x: string; y: string }): Buffer {
  return cborMap([
    cborUint(1), cborUint(2),
    cborUint(3), cborNint(-7),
    cborNint(-1), cborUint(1),
    cborNint(-2), cborBytes(fromBase64Url(jwk.x)),
    cborNint(-3), cborBytes(fromBase64Url(jwk.y)),
  ]);
}

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

const FLAGS_UP_UV_AT = 0x45;
const FLAGS_UP_UV = 0x05;

function authenticatorData(
  rpId: string,
  flags: number,
  signCount: number,
  attested?: { credentialId: Buffer; cose: Buffer },
): Buffer {
  const parts: Buffer[] = [sha256(Buffer.from(rpId)), Buffer.from([flags])];
  const count = Buffer.alloc(4);
  count.writeUInt32BE(signCount, 0);
  parts.push(count);
  if (attested) {
    parts.push(Buffer.alloc(16)); // aaguid 全零
    const len = Buffer.alloc(2);
    len.writeUInt16BE(attested.credentialId.length, 0);
    parts.push(len, attested.credentialId, attested.cose);
  }
  return Buffer.concat(parts);
}

export type ClientData = { type: string; challenge: string; origin: string };

function clientDataJson(data: ClientData): Buffer {
  return Buffer.from(JSON.stringify(data), "utf8");
}

export function buildRegistrationResponse(input: {
  credential: SyntheticCredential;
  challenge: string;
  origin: string;
  rpId: string;
  signCount?: number;
}) {
  const authData = authenticatorData(
    input.rpId,
    FLAGS_UP_UV_AT,
    input.signCount ?? 0,
    { credentialId: input.credential.credentialId, cose: coseKey(input.credential.publicKeyJwk) },
  );
  const attestationObject = cborMap([
    cborText("fmt"), cborText("none"),
    cborText("attStmt"), cborMap([]),
    cborText("authData"), cborBytes(authData),
  ]);
  const clientData = clientDataJson({
    type: "webauthn.create",
    challenge: input.challenge,
    origin: input.origin,
  });
  const id = toBase64Url(input.credential.credentialId);
  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: toBase64Url(clientData),
      attestationObject: toBase64Url(attestationObject),
      transports: ["internal"],
    },
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
  };
}

export function buildAuthenticationResponse(input: {
  credential: SyntheticCredential;
  challenge: string;
  origin: string;
  rpId: string;
  signCount: number;
  userHandle?: string;
}) {
  const authData = authenticatorData(input.rpId, FLAGS_UP_UV, input.signCount);
  const clientData = clientDataJson({
    type: "webauthn.get",
    challenge: input.challenge,
    origin: input.origin,
  });
  const signature = cryptoSign(
    "sha256",
    Buffer.concat([authData, sha256(clientData)]),
    input.credential.privateKey,
  );
  const id = toBase64Url(input.credential.credentialId);
  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: toBase64Url(clientData),
      authenticatorData: toBase64Url(authData),
      signature: toBase64Url(signature),
      userHandle: input.userHandle ?? null,
    },
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
  };
}
