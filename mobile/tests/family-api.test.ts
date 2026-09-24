import { expect, it, vi } from "vitest";
import { createFamilyApi, FamilyError, type FamilyRequest } from "../src/family/api";
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked" }));

const failing = (status: number, json: unknown) =>
  createFamilyApi((async () => ({ status, json })) as FamilyRequest, async () => "t");
const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (e) {
    return e as FamilyError;
  }
  throw new Error("expected a failure");
};
it("我们自己的错误照搬 code 与中文 message", async () => {
  const e = await failure(failing(409, { code: "NAME_TAKEN", message: "家里已经有「妈妈」了。" }).family());
  expect([e.code, e.message, e.status]).toEqual(["NAME_TAKEN", "家里已经有「妈妈」了。", 409]);
});
it("没有 code 的应答不把英文或 HTML 甩给人", async () => {
  const oldServer = await failure(
    failing(404, { message: "Route GET:/api/v1/family not found", error: "Not Found", statusCode: 404 }).family(),
  );
  expect(oldServer.code).toBe("NOT_SUPPORTED");
  expect(oldServer.message).not.toMatch(/Route|not found/);
  expect((await failure(failing(401, {}).family())).code).toBe("AUTH_REQUIRED");
  expect((await failure(failing(429, {}).family())).message).toContain("太频繁");
  expect((await failure(failing(502, {}).family())).message).toBe("服务暂时不可用，请稍后再试。");
});
it("带令牌的请求用钥匙串里的令牌，匿名的不带，确认用刚领到的", async () => {
  const seen: (string | null)[] = [];
  const api = createFamilyApi((async (_m, _p, _b, token) => {
    seen.push(token);
    return { status: 200, json: {} };
  }) as FamilyRequest, async () => "stored");
  await api.family();
  await api.createPair({ publicKey: "p", deviceName: "d", claimHash: "h" });
  await api.confirmPair("r", "fresh");
  expect(seen).toEqual(["stored", null, "fresh"]);
});
