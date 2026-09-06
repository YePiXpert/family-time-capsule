import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("ftc AI configuration boundaries", () => {
  it("runs Python configuration, atomic-write, injection and rollback tests with real Compose parsing", () => {
    const result = spawnSync("python3", [path.resolve("tests/ops/ai_config_test.py")], { encoding: "utf8", timeout: 60_000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain("OK");
  });
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
