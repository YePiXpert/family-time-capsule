import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapSetup,
  fetchBootstrap,
  fetchMe,
  submitOnboarding,
} from "../src/api/client";

afterEach(() => vi.unstubAllGlobals());

const CREDENTIALS = { serverUrl: "https://capsule.example", token: "session-token" };

describe("fetchBootstrap（实例识别）", () => {
  it("识别可用的新实例并归一化地址（去尾斜杠）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          product: "family-time-capsule",
          apiVersion: 1,
          instanceId: "a".repeat(32),
          setup: { state: "available" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBootstrap("https://capsule.example/");
    expect(result.serverUrl).toBe("https://capsule.example");
    expect(result.info.setup.state).toBe("available");
    expect(fetchMock).toHaveBeenCalledWith("https://capsule.example/api/bootstrap", expect.anything());
  });

  it("把普通网页（HTML）明确报成“不是本产品服务”", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>hello</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(fetchBootstrap("https://capsule.example")).rejects.toThrow(
      "该地址不是家庭时间胶囊服务",
    );
  });

  it("维护中（503）与服务不可达（网络错误）有不同提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );
    await expect(fetchBootstrap("https://capsule.example")).rejects.toThrow(
      "服务暂时不可用",
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchBootstrap("https://capsule.example")).rejects.toThrow(
      "无法连接家庭空间",
    );
  });

  it("拒绝把 token 夹带在 query 里的地址", async () => {
    await expect(
      fetchBootstrap("https://capsule.example/?token=secret"),
    ).rejects.toThrow("查询参数");
  });
});

describe("bootstrapSetup（App 内初始化）", () => {
  it("成功时不抛错；错误令牌/已初始化映射为明确文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))),
    );
    await expect(
      bootstrapSetup("https://capsule.example", {
        token: "t", displayName: "妈妈", email: "a@b.com", password: "long-enough",
      }),
    ).resolves.toBeUndefined();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_token" }), { status: 403 }),
      ),
    );
    await expect(
      bootstrapSetup("https://capsule.example", {
        token: "bad", displayName: "妈妈", email: "a@b.com", password: "long-enough",
      }),
    ).rejects.toThrow("初始化令牌不正确");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "already_initialized" }), { status: 409 }),
      ),
    );
    await expect(
      bootstrapSetup("https://capsule.example", {
        token: "t", displayName: "妈妈", email: "a@b.com", password: "long-enough",
      }),
    ).rejects.toThrow("已完成初始化");
  });
});

describe("fetchMe（账号与家庭状态）", () => {
  it("401 时明确会话失效", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(fetchMe(CREDENTIALS)).rejects.toThrow("登录已过期");
  });

  it("解析 needsOnboarding 与 ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "needsOnboarding",
            user: { id: "u1", displayName: "妈妈", email: "a@b.com" },
            account: { role: "admin" },
          }),
        ),
      ),
    );
    await expect(fetchMe(CREDENTIALS)).resolves.toMatchObject({
      status: "needsOnboarding",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ready",
            user: { id: "u1", displayName: "妈妈", email: "a@b.com" },
            account: { role: "admin", personId: null, isGuardian: true },
            family: { id: "f1", name: "小满家", timezone: "Asia/Shanghai" },
          }),
        ),
      ),
    );
    await expect(fetchMe(CREDENTIALS)).resolves.toMatchObject({ status: "ready" });
  });

  it("拒绝形状不合法的响应", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ hello: 1 }))),
    );
    await expect(fetchMe(CREDENTIALS)).rejects.toThrow("无效数据");
  });
});

describe("submitOnboarding（建立家庭）", () => {
  const input = {
    familyName: "小满家", timezone: "Asia/Shanghai", childDisplayName: "小满",
    childBirthDate: "2026-09-02", selfDisplayName: "妈妈", selfRelationToChild: "妈妈",
    selfIsGuardian: true,
  };

  it("成功提交输入；重复建立给出 already_bound 文案", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitOnboarding(CREDENTIALS, input)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://capsule.example/api/mobile/v1/onboarding",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer session-token" }),
        body: JSON.stringify(input),
      }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "already_bound" }), { status: 409 }),
      ),
    );
    await expect(submitOnboarding(CREDENTIALS, input)).rejects.toThrow("已有家庭");
  });
});
