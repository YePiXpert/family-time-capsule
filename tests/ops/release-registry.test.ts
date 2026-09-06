import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 发布注册表测试（M0-V 版本归一化）：
 * 直接驱动 release_tool.py 验证——
 *   1. 版本绝不从镜像 digest 截取；
 *   2. 升级路径用注册表 sequence/纪元白名单判定，不用 sort -V；
 *   3. 探索期 → 正式 1.0 放行，正式 → 探索期拒绝；
 *   4. stable 通道纪律与显式豁免；
 *   5. 注册表自身一致（sequence 单调、tag 不重复、exploration 不再新增）。
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const tool = path.join(repoRoot, "scripts", "ops", "lib", "release_tool.py");

// Windows 开发机 python3 可能是商店存根；与 common.sh 的 ftc_python 同规则。
let pythonBin = "python3";
try {
  execFileSync(pythonBin, ["-c", "print(1)"], { stdio: "pipe" });
} catch {
  pythonBin = "python";
}

interface ReleaseEntry {
  version: string;
  channel: string;
  era: string;
  sequence: number;
  tag: string | null;
}

interface Registry {
  releases: ReleaseEntry[];
}

function runTool(args: string[]) {
  try {
    const stdout = execFileSync(pythonBin, [tool, ...args], { encoding: "utf-8" });
    return { status: 0, stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const registry = JSON.parse(
  readFileSync(path.join(repoRoot, "scripts", "ops", "lib", "releases.json"), "utf-8"),
) as Registry;

describe("release registry 一致性", () => {
  it("sequence 在每个纪元内单调且全局唯一", () => {
    const sequences = registry.releases.map((r) => r.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    const formal = registry.releases.filter((r) => r.era === "formal").map((r) => r.sequence);
    expect([...formal].sort((a, b) => a - b)).toEqual(formal);
    const exploration = registry.releases.filter((r) => r.era === "exploration").map((r) => r.sequence);
    expect([...exploration].sort((a, b) => a - b)).toEqual(exploration);
  });

  it("正式主线的 sequence 全部高于探索期（显式重排，与 SemVer 无关）", () => {
    const maxExploration = Math.max(...registry.releases.filter((r) => r.era === "exploration").map((r) => r.sequence));
    for (const entry of registry.releases.filter((r) => r.era === "formal")) {
      expect(entry.sequence).toBeGreaterThan(maxExploration);
    }
  });

  it("rc.1~rc.4 归探索期；正式候选从 rc.5 起（未占用历史标签）", () => {
    const byVersion = new Map(registry.releases.map((r) => [r.version, r] as const));
    expect(byVersion.get("1.0.0-rc.4")?.era).toBe("exploration");
    expect(byVersion.has("1.0.0-rc.5")).toBe(false); // 发布时才登记
    expect(byVersion.has("1.0.0")).toBe(false); // stable 仅在门禁通过后登记
    const planned = registry.releases; // planned 不在 releases 里
    expect(planned.every((r) => r.version !== "1.0.0")).toBe(true);
  });

  it("版本字符串互不重复，git tag 不重复占用", () => {
    const versions = registry.releases.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    const tags = registry.releases.map((r) => r.tag).filter((t): t is string => Boolean(t));
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe("resolve：版本解析不从 digest 截取", () => {
  it("tag 引用解析出注册表内的版本与通道", () => {
    const result = runTool(["resolve", "--image", "ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1"]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({ version: "1.3.0-alpha.1", channel: "exploration", era: "exploration" });
  });

  it("digest 固定引用拒绝解析并要求 --version（旧 sed 截取缺陷的回归测试）", () => {
    const digest = "ghcr.io/yepixpert/family-time-capsule@sha256:88f2b1c0aa11e1f3f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f80912a3";
    const result = runTool(["resolve", "--image", digest]);
    expect(result.status).toBe(26);
    expect(result.stderr).toContain("--version");
    // 关键回归：绝不能把 digest 尾巴当版本输出。
    expect(result.stdout).not.toContain("88f2b1c0");
  });

  it("digest 引用 + 显式 --version（注册表内）通过", () => {
    const digest = "ghcr.io/yepixpert/family-time-capsule@sha256:88f2b1c0aa11e1f3f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f80912a3";
    const result = runTool(["resolve", "--image", digest, "--version", "1.0.0-dev.1"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).version).toBe("1.0.0-dev.1");
  });

  it("未登记版本被来源白名单拒绝", () => {
    const result = runTool(["resolve", "--image", "ghcr.io/yepixpert/family-time-capsule:9.9.9"]);
    expect(result.status).toBe(26);
    expect(result.stderr).toContain("registry");
  });
});

describe("transition：迁移白名单（不用 sort -V）", () => {
  it("探索期 → 正式 1.0 主线放行（SemVer 会误判为降级的路径）", () => {
    for (const from of ["0.1.0", "1.0.0-rc.4", "1.3.0-alpha.1"]) {
      const result = runTool(["transition", "--from", from, "--to", "1.0.0-dev.1"]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).ok).toBe(true);
    }
  });

  it("正式主线 → 探索期拒绝", () => {
    const result = runTool(["transition", "--from", "1.0.0-dev.1", "--to", "1.3.0-alpha.1"]);
    expect(result.status).toBe(26);
    expect(JSON.parse(result.stdout).ok).toBe(false);
  });

  it("正式主线内部 sequence 回退拒绝；前进放行", () => {
    // 用自定义注册表验证正式主线内部的顺序（正式线目前只有 dev.1，
    // 构造一条 dev.2 验证 sequence 规则本身）。
    const custom = path.join(__dirname, "fixtures-custom-registry.json");
    const extended = {
      ...registry,
      releases: [
        ...registry.releases,
        { version: "1.0.0-dev.2", channel: "development", era: "formal", sequence: 16, tag: null },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(custom, JSON.stringify(extended));
    try {
      const forward = runTool(["transition", "--from", "1.0.0-dev.1", "--to", "1.0.0-dev.2", "--registry", custom]);
      expect(forward.status).toBe(0);
      const backward = runTool(["transition", "--from", "1.0.0-dev.2", "--to", "1.0.0-dev.1", "--registry", custom]);
      expect(backward.status).toBe(26);
    } finally {
      fs.rmSync(custom, { force: true });
    }
  });

  it("stable → 非 stable 需要显式豁免（通道纪律）", () => {
    const custom = path.join(__dirname, "fixtures-custom-registry.json");
    const extended = {
      ...registry,
      releases: [
        ...registry.releases,
        { version: "1.0.0", channel: "stable", era: "formal", sequence: 100, tag: null },
        { version: "1.0.1-rc.1", channel: "candidate", era: "formal", sequence: 101, tag: null },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(custom, JSON.stringify(extended));
    try {
      const refused = runTool(["transition", "--from", "1.0.0", "--to", "1.0.1-rc.1", "--registry", custom]);
      expect(refused.status).toBe(26);
      expect(JSON.parse(refused.stdout).ok).toBe(false);
      const allowed = runTool([
        "transition", "--from", "1.0.0", "--to", "1.0.1-rc.1",
        "--allow-nonstable-target", "--registry", custom,
      ]);
      expect(allowed.status).toBe(0);
    } finally {
      fs.rmSync(custom, { force: true });
    }
  });

  it("未注册版本参与迁移时直接拒绝", () => {
    const result = runTool(["transition", "--from", "1.3.0-alpha.1", "--to", "2.0.0"]);
    expect(result.status).toBe(26);
  });
});
