import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Windows 开发机 python3 可能是商店存根；与 common.sh 的 ftc_python 同规则。
let pythonBin = "python3";
try {
  execFileSync(pythonBin, ["-c", "print(1)"], { stdio: "pipe" });
} catch {
  pythonBin = "python";
}

// Python 套件需要真实 `docker compose` 做解析验证；与 compose-config.test.ts
// 相同的门控：无 docker 的开发机跳过，CI（或 FTC_REQUIRE_COMPOSE=1）必须跑。
const dockerAvailable = spawnSync("docker", ["compose", "version"], { stdio: "pipe" }).status === 0;
const requireCompose = process.env.FTC_REQUIRE_COMPOSE === "1";

describe("ftc AI configuration boundaries", () => {
  it.skipIf(!dockerAvailable && !requireCompose)(
    "runs Python configuration, atomic-write, injection and rollback tests with real Compose parsing",
    () => {
      const result = spawnSync(pythonBin, [path.resolve("tests/ops/ai_config_test.py")], { encoding: "utf8", timeout: 60_000 });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stderr).toContain("OK");
    },
  );
  it("provides an executable help entry and rejects a Key in command arguments", () => {
    const help = spawnSync("bash", ["scripts/ops/ftc", "ai", "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("configure");
    expect(help.stdout).toContain("transcription");
    for (const args of [["configure", "--key", "not-a-real-secret"], ["not-a-real-secret"], ["test", "--capability", "not-a-real-secret"]]) {
      const invalid = spawnSync("bash", ["scripts/ops/ftc", "ai", ...args], { encoding: "utf8" });
      expect(invalid.status).not.toBe(0);
      expect(invalid.stdout + invalid.stderr).not.toContain("not-a-real-secret");
    }
  });
});
