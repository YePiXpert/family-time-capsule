import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { x25519 } from "@noble/curves/ed25519.js";
import { createFamilyApi, fetchRequest, FamilyError, type FamilyApi } from "../src/family/api";
import {
  approveJoin,
  inspectJoin,
  parsePairQr,
  pairQrText,
  pollJoin,
  recoverAsAdmin,
  recoveryAdmins,
  regenerateRecovery,
  requestToJoin,
  startFamily,
  upgradeFamily,
  type FlowDeps,
  type Vault,
} from "../src/family/pairing";
import { keyIdOf } from "../src/sync/crypto";
import { startServer, type E2EServer } from "./helpers/e2e-server";
/**
 * 家庭与设备的真端到端：真实服务端子进程，两三台「手机」各有自己的内存保险箱，
 * 走完 开家庭 → 出码 → 扫码核对 → 批准 → 新手机解包确认 → 换恢复码 → 凭恢复码找回。
 * 断言的重点是：新手机拿到的内容钥匙和管理者的一模一样，服务器从头到尾没见过它。
 */
vi.mock("expo-crypto", () => ({
  randomUUID,
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
}));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked",
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
// 流程全部注入保险箱，不碰真机钥匙串与文件。
vi.mock("../src/sync/state", () => ({
  loadKey: async () => {
    throw new Error("e2e 不该读真机钥匙串");
  },
  storeKey: async () => {
    throw new Error("e2e 不该写真机钥匙串");
  },
}));
type Phone = FlowDeps & { vault: Vault; box: { key: Uint8Array | null; token: string | null } };
function phone(base: string): Phone {
  const box = { key: null as Uint8Array | null, token: null as string | null };
  const secretKey = new Uint8Array(randomBytes(32));
  const device = { secretKey, publicKey: x25519.getPublicKey(secretKey) };
  const vault: Vault = {
    loadKey: async () => box.key,
    storeKey: async (key) => {
      box.key = key;
    },
    ensureDeviceKey: async () => device,
    saveToken: async (token) => {
      box.token = token;
    },
  };
  const api: FamilyApi = createFamilyApi(fetchRequest(base), async () => box.token);
  return { api, vault, box };
}
let server: E2EServer;
beforeAll(async () => {
  server = await startServer();
}, 60000);
afterAll(async () => {
  await server?.stop();
});
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof FamilyError ? error.code : String(error);
  }
  return "no error";
};
it("开家庭、扫码加手机、换恢复码、凭恢复码找回，钥匙一路不经服务器", async () => {
  const dad = phone(server.base);
  expect(await dad.api.status()).toEqual({ initialized: false, family: false });
  const started = await startFamily(dad, {
    activationCode: server.activationCode(),
    memberName: "爸爸",
    deviceName: "爸爸的 iPhone",
  });
  expect(started.words.split(" ")).toHaveLength(12);
  expect(dad.box.key).toEqual(started.key);
  expect(dad.box.token).toBeTruthy();
  const family = await dad.api.family();
  expect(family).toMatchObject({
    familyId: started.familyId,
    keyId: keyIdOf(started.key),
    recoveryVersion: 1,
    me: { name: "爸爸", role: "admin" },
  });

  // 萌萌的新手机：出码。还没批准时轮询只说「等着」。
  const mengmeng = phone(server.base);
  const join = await requestToJoin(mengmeng, "萌萌的 OPPO");
  expect(parsePairQr(join.qr).requestId).toBe(join.requestId);
  expect(await pollJoin(mengmeng, join)).toBeNull();

  // 爸爸扫码：核对后以新家人「萌萌」、管理者身份批准。
  const inspected = await inspectJoin(dad, join.qr);
  expect(inspected.pending.deviceName).toBe("萌萌的 OPPO");
  const binding = await approveJoin(dad, inspected, { kind: "new", name: "萌萌", role: "admin" });
  expect(binding).toMatchObject({ familyId: started.familyId, role: "admin", deviceName: "萌萌的 OPPO" });

  const joined = await pollJoin(mengmeng, join);
  expect(joined?.key).toEqual(started.key);
  expect(mengmeng.box.key).toEqual(started.key);
  expect(joined?.member).toMatchObject({ name: "萌萌", role: "admin" });
  expect((await mengmeng.api.family()).me.name).toBe("萌萌");
  // 同一张码不能再批一次。
  expect(await code(inspectJoin(dad, join.qr))).toBe("PAIR_CLOSED");

  // 爸爸换恢复码：旧的 12 个词立刻作废，新的能列出两位管理者。
  const fresh = await regenerateRecovery(dad);
  expect((await dad.api.family()).recoveryVersion).toBe(2);
  expect(await code(recoveryAdmins(phone(server.base), started.words))).toBe("RECOVERY_INVALID");
  const lost = phone(server.base);
  const { secret, admins } = await recoveryAdmins(lost, fresh.words);
  expect(admins.map((a) => a.name).sort()).toEqual(["爸爸", "萌萌"]);
  const dadId = admins.find((a) => a.name === "爸爸")!.id;
  const recovered = await recoverAsAdmin(lost, secret, dadId, "爸爸的新手机");
  expect(recovered.key).toEqual(started.key);
  expect(lost.box.key).toEqual(started.key);
  expect((await lost.api.family()).me).toMatchObject({ memberId: dadId, role: "admin" });
}, 60000);

it("二维码里的公钥和服务端对不上就停；不是配对码的解析失败", async () => {
  // 各用例各起一个服务端，互不借状态。
  const other = await startServer();
  try {
    const admin = phone(other.base);
    await startFamily(admin, { activationCode: other.activationCode(), memberName: "爸爸", deviceName: "爸爸的手机" });
    const newbie = phone(other.base);
    const join = await requestToJoin(newbie, "外婆的手机");
    const qr = parsePairQr(join.qr);
    // 有人把二维码换成自己的公钥（或服务端把申请换了公钥）：管理者这边核对失败，不封钥匙。
    const swapped = pairQrText({ ...qr, publicKey: x25519.getPublicKey(new Uint8Array(randomBytes(32))) });
    expect(await code(inspectJoin(admin, swapped))).toBe("PAIR_MISMATCH");

    // 二维码里的 S 被改了：管理者照改过的 S 封包，新手机用自己的 S 解不开，也就不会确认、不会存钥匙。
    const wrongPsk = pairQrText({ ...qr, psk: new Uint8Array(randomBytes(32)) });
    await approveJoin(admin, await inspectJoin(admin, wrongPsk), { kind: "new", name: "外婆", role: "member" });
    await expect(pollJoin(newbie, join)).rejects.toThrow("这份授权对不上");
    expect(newbie.box.key).toBeNull();
    expect(newbie.box.token).toBeNull();

    for (const text of ["", "hello", "anan-pair:1:x:y:z", `${join.qr}:extra`, join.qr.replace(/:[^:]+$/, ":AAAA")])
      expect(await code(Promise.resolve().then(() => parsePairQr(text)))).toBe("QR_INVALID");

    // 普通家人不能批准：先以家人身份加一台，再让它去扫别人的码。
    const kid = phone(other.base);
    const kidJoin = await requestToJoin(kid, "桉桉的平板");
    await approveJoin(admin, await inspectJoin(admin, kidJoin.qr), { kind: "new", name: "桉桉", role: "member" });
    expect((await pollJoin(kid, kidJoin))?.member.role).toBe("member");
    const third = await requestToJoin(phone(other.base), "第三台");
    expect(["ADMIN_ONLY", "FORBIDDEN"]).toContain(await code(inspectJoin(kid, third.qr)));

    // 同一位家人再加一台手机：选「已有家人」。
    const kid2 = phone(other.base);
    const kid2Join = await requestToJoin(kid2, "桉桉的新平板");
    const inspected = await inspectJoin(admin, kid2Join.qr);
    const anan = inspected.family.members.find((m) => m.name === "桉桉")!;
    await approveJoin(admin, inspected, { kind: "existing", memberId: anan.id });
    expect((await pollJoin(kid2, kid2Join))?.member).toMatchObject({ id: anan.id, role: "member" });
  } finally {
    await other.stop();
  }
}, 60000);

it("1.0.8 的主人手机升级成家庭管理者，沿用本机原有的内容钥匙", async () => {
  const owner = "00000000-0000-4000-8000-000000000001";
  const token = randomBytes(32).toString("base64url");
  const legacy = await startServer((file) => {
    const raw = new DatabaseSync(file);
    raw.exec(`CREATE TABLE members(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,photo_limit INTEGER NOT NULL DEFAULT 100,write_limit INTEGER NOT NULL DEFAULT 20,username TEXT,password_hash TEXT,backup_limit_bytes INTEGER NOT NULL DEFAULT 21474836480);
      CREATE TABLE devices(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      INSERT INTO members(id,name,role,username,password_hash) VALUES('${owner}','主人','owner','主人','scrypt2:x');`);
    raw
      .prepare("INSERT INTO devices VALUES(?,?,?,?,0,?)")
      .run(randomUUID(), owner, "主人手机", createHash("sha256").update(token).digest("hex"), Date.now());
    raw.close();
  });
  try {
    const dad = phone(legacy.base);
    const oldKey = new Uint8Array(randomBytes(16));
    dad.box.key = oldKey;
    dad.box.token = token;
    expect(await dad.api.status()).toEqual({ initialized: true, family: false });
    expect(await code(dad.api.family())).toBe("FAMILY_MISSING");
    const upgraded = await upgradeFamily(dad);
    expect(upgraded.key).toEqual(oldKey);
    expect(upgraded.words.split(" ")).toHaveLength(12);
    expect(await dad.api.family()).toMatchObject({
      familyId: upgraded.familyId,
      keyId: keyIdOf(oldKey),
      me: { memberId: owner, role: "admin" },
    });
    expect(await code(upgradeFamily(dad))).not.toBe("no error");
    // 升级后的恢复码能找回同一把钥匙。
    const lost = phone(legacy.base);
    const { secret, admins } = await recoveryAdmins(lost, upgraded.words);
    expect((await recoverAsAdmin(lost, secret, admins[0]!.id, "新手机")).key).toEqual(oldKey);
  } finally {
    await legacy.stop();
  }
}, 60000);
