import { beforeEach, expect, it, vi } from "vitest";
import {
  SyncError,
  createTransport,
  type HttpRequest,
  type HttpResponse,
} from "../src/sync/transport";
// 传输层只为拿设备凭证碰一下钥匙串；这里的令牌都由测试注入。
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked",
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
const seen: HttpRequest[] = [];
let answer: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const http = async (request: HttpRequest) => {
  seen.push(request);
  return answer(request);
};
const transport = () =>
  createTransport(http, "http://service.test/api/v1", async () => "tok-1");
async function failure(fn: () => Promise<unknown>): Promise<SyncError> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof SyncError) return e;
    throw new Error(`expected a SyncError but got: ${String(e)}`);
  }
  throw new Error("expected the call to fail");
}
beforeEach(() => {
  seen.length = 0;
  answer = () => ({ status: 200, body: encode({}) });
});
it("sends the bearer token and the base path on every call, and never calls without a token", async () => {
  answer = () => ({ status: 200, body: encode({ keyId: null, objects: 0 }) });
  await transport().status();
  expect(seen[0]!.url).toBe("http://service.test/api/v1/backup/status");
  expect(seen[0]!.headers.Authorization).toBe("Bearer tok-1");
  expect(seen[0]!.timeoutMs).toBe(115000);
  const anonymous = createTransport(
    http,
    "http://service.test/api/v1",
    async () => null,
  );
  const error = await failure(() => anonymous.status());
  expect(error.code).toBe("AUTH_REQUIRED");
  expect(error.message).toContain("登录");
  expect(seen).toHaveLength(1);
});
it("uploads bytes as octet-stream with the ciphertext hash and reads created from 201", async () => {
  answer = (request) => ({
    status: request.method === "PUT" ? 201 : 200,
    body: encode({ id: "x", bytes: 3 }),
  });
  const bytes = new Uint8Array([1, 2, 3]);
  expect(
    await transport().put("ab".repeat(32), bytes, "cd".repeat(32)),
  ).toEqual({ created: true });
  const request = seen[0]!;
  expect(request.method).toBe("PUT");
  expect(request.url).toBe(
    `http://service.test/api/v1/backup/objects/${"ab".repeat(32)}`,
  );
  expect(request.headers["Content-Type"]).toBe("application/octet-stream");
  expect(request.headers["X-Object-Sha256"]).toBe("cd".repeat(32));
  expect(request.body).toBe(bytes);
  answer = () => ({ status: 200, body: encode({ id: "x", bytes: 3 }) });
  expect(
    await transport().put("ab".repeat(32), bytes, "cd".repeat(32)),
  ).toEqual({ created: false });
  // 下载原样拿回二进制，不去解析。
  answer = () => ({ status: 200, body: new Uint8Array([9, 8, 7]) });
  expect(await transport().get("ab".repeat(32))).toEqual(
    new Uint8Array([9, 8, 7]),
  );
});
it("asks have in batches of 2000 and merges the missing ids", async () => {
  answer = (request) => {
    const { ids } = JSON.parse(request.body as string) as { ids: string[] };
    return {
      status: 200,
      body: encode({ missing: ids.filter((_, i) => i % 2 === 0) }),
    };
  };
  const ids = Array.from({ length: 4500 }, (_, i) => String(i));
  const missing = await transport().missing(ids);
  expect(
    seen.map(
      (r) => (JSON.parse(r.body as string) as { ids: string[] }).ids.length,
    ),
  ).toEqual([2000, 2000, 500]);
  expect(missing.size).toBe(2250);
  expect(missing.has("0")).toBe(true);
  expect(missing.has("1")).toBe(false);
});
it("maps service errors by code, gateway pages by status and a lost connection to plain words", async () => {
  answer = () => ({
    status: 413,
    body: encode({ code: "QUOTA_FULL", message: "远端备份空间已用完。" }),
  });
  let error = await failure(() =>
    transport().put("ab".repeat(32), new Uint8Array(1), "cd".repeat(32)),
  );
  expect([error.code, error.message, error.status]).toEqual([
    "QUOTA_FULL",
    "远端备份空间已用完。",
    413,
  ]);
  answer = () => ({
    status: 413,
    body: new TextEncoder().encode("<html>413 Request Entity Too Large</html>"),
  });
  error = await failure(() =>
    transport().put("ab".repeat(32), new Uint8Array(1), "cd".repeat(32)),
  );
  expect(error.code).toBe("TOO_LARGE");
  expect(error.message).not.toContain("<html>");
  answer = () => ({ status: 401, body: new Uint8Array(0) });
  error = await failure(() => transport().status());
  expect(error.code).toBe("AUTH_REQUIRED");
  answer = () => ({
    status: 507,
    body: encode({
      code: "SERVER_FULL",
      message: "服务器空间不足，请联系主人。",
    }),
  });
  error = await failure(() => transport().status());
  expect(error.code).toBe("SERVER_FULL");
  answer = () => ({ status: 200, body: new TextEncoder().encode("not json") });
  error = await failure(() => transport().status());
  expect(error.code).toBe("SERVER_ERROR");
  answer = () => {
    throw new TypeError("Network request failed");
  };
  error = await failure(() => transport().status());
  expect([error.code, error.message]).toEqual([
    "NETWORK",
    "现在连不上服务，请稍后再试。",
  ]);
  const controller = new AbortController();
  controller.abort();
  answer = () => {
    throw new Error("aborted");
  };
  error = await failure(() => transport().status(controller.signal));
  expect(error.code).toBe("CANCELED");
});
it("round-trips the manifest index, treats 404 as no manifest yet, and passes keep to prune", async () => {
  answer = () => ({
    status: 200,
    body: encode({ updatedAt: "2026-09-20T00:00:00.000Z" }),
  });
  expect(
    await transport().putManifest("ab".repeat(8), "QUJD", ["a", "b"]),
  ).toBe("2026-09-20T00:00:00.000Z");
  expect(JSON.parse(seen[0]!.body as string)).toEqual({
    keyId: "ab".repeat(8),
    index: "QUJD",
    objects: ["a", "b"],
  });
  answer = () => ({
    status: 404,
    body: encode({ code: "NOT_FOUND", message: "远端还没有备份。" }),
  });
  expect(await transport().getManifest()).toBeNull();
  answer = () => ({
    status: 200,
    body: encode({ keyId: "ab".repeat(8), index: "QUJD", updatedAt: "t" }),
  });
  expect(await transport().getManifest()).toEqual({
    keyId: "ab".repeat(8),
    index: "QUJD",
    updatedAt: "t",
  });
  answer = () => ({ status: 200, body: encode({ removed: 2, bytes: 10 }) });
  expect(await transport().prune(["a", "b"])).toEqual({
    removed: 2,
    bytes: 10,
  });
  expect(seen.at(-1)!.url).toBe("http://service.test/api/v1/backup/prune");
  expect(JSON.parse(seen.at(-1)!.body as string)).toEqual({ keep: ["a", "b"] });
  answer = () => ({ status: 200, body: encode({ ok: true }) });
  await transport().wipe();
  expect(seen.at(-1)!.method).toBe("DELETE");
  expect(seen.at(-1)!.url).toBe("http://service.test/api/v1/backup");
});
it("reads the family: status counts manifests (0 on an older service), the manifest carries its device, and the listing is validated", async () => {
  answer = () => ({
    status: 200,
    body: encode({ keyId: null, objects: 0, bytes: 0, limitBytes: 1, freeBytes: 1 }),
  });
  expect((await transport().status()).manifests).toBe(0);
  answer = () => ({ status: 200, body: encode({ keyId: "k", objects: 3, manifests: 2 }) });
  expect((await transport().status()).manifests).toBe(2);
  answer = () => ({
    status: 200,
    body: encode({
      deviceId: "d-1",
      keyId: "ab".repeat(8),
      index: "QUJD",
      updatedAt: "t",
    }),
  });
  expect(await transport().getManifest()).toEqual({
    deviceId: "d-1",
    keyId: "ab".repeat(8),
    index: "QUJD",
    updatedAt: "t",
  });
  const listing = [
    {
      deviceId: "d-1",
      memberId: "m-1",
      deviceName: "爸爸的手机",
      keyId: "ab".repeat(8),
      index: "QUJD",
      updatedAt: "2026-09-21T00:00:02.000Z",
    },
    {
      deviceId: "legacy:m-2",
      memberId: "m-2",
      deviceName: null,
      keyId: "ab".repeat(8),
      index: "REVG",
      updatedAt: "2026-09-21T00:00:01.000Z",
    },
  ];
  answer = () => ({ status: 200, body: encode(listing) });
  expect(await transport().manifests()).toEqual(listing);
  expect(seen.at(-1)!.url).toBe(
    "http://service.test/api/v1/backup/manifests",
  );
  // 没有设备名的旧行按 null 给；缺字段的条目让整份列表作废，而不是悄悄少一台手机。
  answer = () => ({
    status: 200,
    body: encode([{ ...listing[0], deviceName: undefined }]),
  });
  expect((await transport().manifests())[0]!.deviceName).toBeNull();
  answer = () => ({ status: 200, body: encode([{ deviceId: "d-1" }]) });
  expect((await failure(() => transport().manifests())).code).toBe(
    "SERVER_ERROR",
  );
  answer = () => ({ status: 200, body: encode({ items: [] }) });
  expect((await failure(() => transport().manifests())).code).toBe(
    "SERVER_ERROR",
  );
});
it("deletes one device's manifest, wipes the family only through the admin route, and words OWNER_ONLY", async () => {
  answer = () => ({ status: 200, body: encode({ ok: true, pruned: 3 }) });
  expect(await transport().deleteManifest("d-1")).toEqual({ pruned: 3 });
  expect(seen.at(-1)!.method).toBe("DELETE");
  expect(seen.at(-1)!.url).toBe(
    "http://service.test/api/v1/backup/manifests/d-1",
  );
  answer = () => ({ status: 200, body: encode({ ok: true }) });
  await transport().wipeFamily();
  expect(seen.at(-1)!.method).toBe("DELETE");
  expect(seen.at(-1)!.url).toBe("http://service.test/api/v1/admin/backup");
  answer = () => ({ status: 403, body: encode({ code: "OWNER_ONLY" }) });
  const error = await failure(() => transport().wipeFamily());
  expect([error.code, error.status]).toEqual(["OWNER_ONLY", 403]);
  expect(error.message).toContain("主人");
});
