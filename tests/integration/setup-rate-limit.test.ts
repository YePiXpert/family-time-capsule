import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "ftc-setup-limit-"));
process.env.DATA_DIR = dataDir;
process.env.INITIAL_SETUP_TOKEN = "setup-limit-secret-token";
process.env.AUTH_SECRET = "setup-rate-limit-test-secret-0123456789";
process.env.BETTER_AUTH_URL = "http://localhost";

afterAll(async () => {
  const { closeDatabase } = await import("@/db");
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

const { performSetup, countUsers } = await import("@/lib/auth/setup");
const { getDb } = await import("@/db");
const { rateLimit } = await import("@/db/schema/auth");

const INPUT = {
  token: "wrong-setup-token",
  displayName: "测试管理员",
  email: "setup-limit@example.test",
  password: "a-long-enough-password",
};

describe("setup 持久化限流", () => {
  it("15 分钟内仅允许 10 次尝试，且限流键不保存 setup token", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(performSetup(INPUT)).resolves.toEqual({
        ok: false,
        error: "invalid_token",
      });
    }

    await expect(performSetup(INPUT)).resolves.toEqual({
      ok: false,
      error: "rate_limited",
    });
    await expect(countUsers()).resolves.toBe(0);

    const rows = getDb().select().from(rateLimit).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(11);
    expect(rows[0].key).toMatch(/^ftc:setup:[a-f0-9]{64}$/u);
    expect(rows[0].key).not.toContain(INPUT.token);
    expect(rows[0].key).not.toContain(process.env.INITIAL_SETUP_TOKEN ?? "");
  });
});
