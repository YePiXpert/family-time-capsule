import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * ftc 运维工具测试（M5/M6）：用假 docker（tests/ops/fake-docker.sh）在隔离
 * FTC_ROOT 中验证参数处理、幂等、端口审计、快照校验、失败分级与锁。
 * 不 mock 掉脚本本身——脚本真实执行，只有 docker/curl 是假的。
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const opsDir = path.join(repoRoot, "scripts", "ops");

let workspace: string;
let ftcRoot: string;
let binDir: string;
let dockerLog: string;
let composeJson: string;

const COMPOSE_LOOPBACK_OK = {
  services: {
    app: {
      image: "ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1",
      ports: [{ mode: "ingress", target: 3000, published: "3001", host_ip: "127.0.0.1", protocol: "tcp" }],
    },
    worker: { image: "ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1" },
  },
};

const COMPOSE_PUBLIC_3000 = {
  services: {
    app: {
      image: "ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1",
      ports: [{ mode: "ingress", target: 3000, published: "3000", host_ip: "0.0.0.0", protocol: "tcp" }],
    },
    worker: {},
  },
};

/**
 * MSYS(Git Bash) 会对带路径形态的环境值做不可控转换（分隔符被吞），
 * 因此所有路径型变量写进包装脚本由 bash 自己 source，不走进程环境。
 */
function bashQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

function runBash(scriptPath: string, args: string[], extraEnv: Record<string, string>) {
  const wrapper = path.join(workspace, "env.sh");
  const lines = [
    `export FTC_ROOT=${bashQuote(toPosix(ftcRoot))}`,
    "export FTC_SKIP_ROOT_CHECK=1",
    `export FAKE_DOCKER_LOG=${bashQuote(toPosix(dockerLog))}`,
    `export FAKE_COMPOSE_JSON=${bashQuote(toPosix(composeJson))}`,
    ...Object.entries(extraEnv).map(([key, value]) => `export ${key}=${bashQuote(String(value))}`),
  ];
  writeFileSync(wrapper, `${lines.join("\n")}\n`);
  const quoted = [scriptPath, ...args].map(bashQuote).join(" ");
  return spawnSync("bash", ["-c", `. ${bashQuote(wrapper)} && exec bash ${quoted}`], {
    encoding: "utf8",
    timeout: 60_000,
  });
}

function run(script: string, args: string[], extraEnv: Record<string, string> = {}) {
  const scriptPath = script.endsWith(".sh") ? path.join(opsDir, script) : path.join(opsDir, `${script}.sh`);
  return runBash(scriptPath, args, extraEnv);
}

function runFtc(args: string[], extraEnv: Record<string, string> = {}) {
  return runBash(path.join(opsDir, "ftc"), args, extraEnv);
}

function fakeAwarePath(dir: string): string {
  // vitest 可能继承 POSIX 风格 PATH（Git Bash 启动），此时统一用 ":" 分隔并
  // 把 Windows 目录改写为 /c/... 形式；CI（Linux）天然一致。
  const inherited = process.env.PATH ?? "";
  const posixStyle = inherited.includes(":") && !inherited.includes(";");
  const entry = posixStyle && process.platform === "win32"
    ? dir.split(path.sep).join("/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
    : dir;
  return `${entry}${posixStyle ? ":" : path.delimiter}${inherited}`;
}

function dockerCalls(): string[] {
  return existsSync(dockerLog) ? readFileSync(dockerLog, "utf8").split("\n").filter(Boolean) : [];
}

function writeFakeCurl(dir: string, body: string) {
  writeFileSync(path.join(dir, "curl"), ["#!/usr/bin/env bash", body, ""].join("\n"));
  execFileSync("bash", ["-c", `chmod +x '${path.join(dir, "curl")}'`]);
}

/** 走完一次成功安装，返回 env 文件内容（含生成的密钥）。 */
function installOnce(env: Record<string, string> = {}) {
  const result = run("install", [
    "--yes", "--domain", "capsule.example.com", "--mode", "loopback",
    "--image", "ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1",
  ], env);
  expect(result.status).toBe(0);
  // Backups verify actual SQLite and original bytes, not placeholder text files.
  const dataDir = `${dockerLog.replace(/\.log$/u, "")}-volume`;
  mkdirSync(path.join(dataDir, "db"), { recursive: true });
  mkdirSync(path.join(dataDir, "originals"), { recursive: true });
  const database = new Database(path.join(dataDir, "db", "capsule.sqlite"));
  database.exec(`CREATE TABLE IF NOT EXISTS family(id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS user(id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS memory_event(id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS session(id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS verification(id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS asset(id TEXT PRIMARY KEY, storage_key TEXT, bytes INTEGER, sha256 TEXT, original_asset_id TEXT);`);
  database.prepare("INSERT OR REPLACE INTO asset VALUES ('photo','originals/a.jpg',?,?,NULL)")
    .run(Buffer.byteLength("photo-bytes"), createHash("sha256").update("photo-bytes").digest("hex"));
  database.close();
  writeFileSync(path.join(dataDir, "originals", "a.jpg"), "photo-bytes");
  return readFileSync(path.join(ftcRoot, "config", "env"), "utf8");
}

/** Windows 下给 bash 用的 POSIX 路径（/c/...），CI（Linux）原样返回。 */
function toPosix(p: string): string {
  // 用 fromCharCode(92) 表示反斜杠，避免任何工具折叠转义序列。
  const backslash = String.fromCharCode(92);
  const isWindowsPath =
    process.platform === "win32" &&
    p.length > 2 &&
    p[1] === ":" &&
    (p[2] === "/" || p[2] === backslash);
  if (isWindowsPath) {
    return `/${p[0]!.toLowerCase()}${p.slice(2).split(backslash).join("/")}`;
  }
  return p;
}

beforeEach(() => {
  workspace = mkdtempSync(path.join(process.env.FTC_TEST_TEMP_DIR ?? tmpdir(), "ftc-ops-"));
  ftcRoot = path.join(workspace, "root");
  binDir = path.join(workspace, "bin");
  dockerLog = path.join(workspace, "docker.log");
  composeJson = path.join(workspace, "compose.json");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(composeJson, JSON.stringify(COMPOSE_LOOPBACK_OK));
  const fake = readFileSync(path.join(repoRoot, "tests", "ops", "fake-docker.sh"), "utf-8");
  writeFileSync(path.join(binDir, "docker"), fake.replace("#!/usr/bin/env bash", "#!/usr/bin/env bash"));
  execFileSync("bash", ["-c", `chmod +x '${path.join(binDir, "docker")}'`]);
  // Windows 开发机没有 flock（CI 的 Linux 有）。测试里的真实互斥由
  // mkdir+PID 锁保证；flock 只承担 AI 独占闸门，这里垫一个直通实现，
  // 让套件能在开发机上运行，不改变任何生产行为。
  const flockProbe = spawnSync("bash", ["-c", "command -v flock >/dev/null 2>&1 && echo yes || echo no"], { encoding: "utf8" });
  if (flockProbe.stdout.trim() === "no") {
    writeFileSync(
      path.join(binDir, "flock"),
      ["#!/usr/bin/env bash", "# 测试垫片：仅 Windows 开发机缺 flock 时使用。", "exit 0", ""].join("\n"),
    );
    execFileSync("bash", ["-c", `chmod +x '${path.join(binDir, "flock")}'`]);
  }
  // 默认提供"可达"的假 curl；需要部分完成场景的用例单独覆盖。
  writeFakeCurl(binDir, "exit 0");
  process.env.PATH = fakeAwarePath(binDir);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("ftc 入口", () => {
  it("version/--help 可用，未知命令返回 2", () => {
    const productVersion = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
    expect(runFtc(["version"]).stdout.trim()).toBe(productVersion);
    const help = runFtc(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("install");
    expect(runFtc(["nope"]).status).toBe(2);
  });
});

describe("ftc install", () => {
  it("完成安装：生成密钥/令牌、写配置与部署记录", () => {
    const env = installOnce();
    expect(env).toContain("AUTH_SECRET=");
    expect(env).toContain("INITIAL_SETUP_TOKEN=");
    expect(existsSync(path.join(ftcRoot, "config", "initial-setup-token"))).toBe(true);
    expect(existsSync(path.join(ftcRoot, "releases", "current", "compose.yml"))).toBe(true);
    const deployments = readdirSync(path.join(ftcRoot, "state", "deployments"));
    expect(deployments.length).toBe(1);
    expect(readFileSync(path.join(ftcRoot, "state", "current_version"), "utf8")).toBe("1.3.0-alpha.1");
    // 令牌不进日志
    const token = readFileSync(path.join(ftcRoot, "config", "initial-setup-token"), "utf8").trim();
    for (const line of dockerCalls()) {
      expect(line).not.toContain(token);
    }
  });

  it("二次运行是只读检查：不重置密钥、不重建卷", () => {
    const first = installOnce();
    const volumeCreateCalls = dockerCalls().filter((c) => c.includes("volume create")).length;
    const second = run("install", ["--yes"]);
    expect(second.status).toBe(0);
    expect(second.stderr).toContain("已有安装");
    expect(readFileSync(path.join(ftcRoot, "config", "env"), "utf8")).toBe(first);
    const volumeCreateCallsAfter = dockerCalls().filter((c) => c.includes("volume create")).length;
    expect(volumeCreateCallsAfter).toBe(volumeCreateCalls);
  });

  it("检测到同名数据卷时拒绝安装（不覆盖未确认归属的卷）", () => {
    const marker = path.join(workspace, "conflict");
    writeFileSync(marker, "1");
    const result = run("install", [
      "--yes", "--domain", "capsule.example.com", "--mode", "loopback",
      "--image", "ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1",
    ], { FAKE_DOCKER_CONFLICT_VOLUME: marker });
    expect(result.status).toBe(10);
    expect(result.stderr).toContain("数据卷");
  });

  it("最终 compose 配置公开 3000 时中止（端口审计）", () => {
    writeFileSync(composeJson, JSON.stringify(COMPOSE_PUBLIC_3000));
    const result = run("install", [
      "--yes", "--domain", "capsule.example.com", "--mode", "loopback",
      "--image", "ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1",
    ]);
    expect(result.status).toBe(12);
    expect(result.stderr).toContain("公开暴露");
  });

  it("外部 HTTPS 不可达时只报部分完成（exit 3），不宣称成功", () => {
    // 环回 HTTP 成功不能代替公网 HTTPS 验收。
    writeFakeCurl(binDir, '[[ "$*" == *"http://127.0.0.1:"* ]]');
    const result = run("install", [
      "--yes", "--domain", "capsule.example.com", "--mode", "loopback",
      "--image", "ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1",
    ]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("部分完成");
  });

  it("健康检查失败时即使跳过 HTTPS 也不能报告安装成功", () => {
    const marker = path.join(workspace, "health-failure");
    writeFileSync(marker, "1");
    const result = run("install", [
      "--yes", "--domain", "capsule.example.com", "--mode", "loopback",
      "--image", "ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1", "--skip-https-check",
    ], { FAKE_DOCKER_FAIL_HEALTHCHECK: marker });
    expect(result.status).toBe(13);
  });
});

describe("ftc backup / cleanup", () => {
  it("cleanup refuses zero retention without deleting the remaining snapshot", () => {
    installOnce();
    const snapshot = path.join(ftcRoot, "backups/ftc-snapshot-keep.tar.gz");
    writeFileSync(snapshot, "synthetic last snapshot");
    expect(run("cleanup", ["--apply", "--keep", "0"]).status).toBe(2);
    expect(readFileSync(snapshot, "utf8")).toBe("synthetic last snapshot");
  });
  it("打包失败后恢复服务，保留失败阶段且释放操作锁", () => {
    installOnce();
    const marker = path.join(workspace, "pack-failure");
    writeFileSync(marker, "1");
    const result = run("backup", [], { FAKE_DOCKER_FAIL_PACK: marker });
    expect(result.status).toBe(23);
    const calls = dockerCalls();
    const stop = calls.findIndex((c) => c.includes("stop app worker"));
    expect(stop).toBeGreaterThan(-1);
    expect(calls.slice(stop + 1).some((c) => c.includes("up -d --wait"))).toBe(true);
    expect(existsSync(path.join(ftcRoot, "state", "locks", "backup"))).toBe(false);
    expect(readFileSync(path.join(ftcRoot, "state", "phase"), "utf8")).toBe("backup-pack");
    expect(readdirSync(path.join(ftcRoot, "backups"))).toEqual([]);
  });

  it("生成快照并通过 verify；篡改后 verify 失败", () => {
    installOnce();
    // 造一个"数据卷"：fake docker run 的 tar 会打包其默认卷目录
    // （<docker.log 去扩展名>-volume）。用 node 直接写同一物理目录，
    // 避免跨 shell 的路径形态转换。
    const dataDir = `${dockerLog.replace(/\.log$/u, "")}-volume`;
    mkdirSync(path.join(dataDir, "db"), { recursive: true });
    mkdirSync(path.join(dataDir, "originals"), { recursive: true });
    writeFileSync(path.join(dataDir, "originals", "a.jpg"), "photo-bytes");
    const result = run("backup", []);
    expect(result.status).toBe(0);
    const snapshots = readdirSync(path.join(ftcRoot, "backups")).filter((f) => f.endsWith(".tar.gz"));
    expect(snapshots.length).toBe(1);
    const snapPath = path.join(ftcRoot, "backups", snapshots[0]);
    const verify = run("backup", ["verify", toPosix(snapPath)]);
    expect(verify.status).toBe(0);
    expect(verify.stderr).toContain("校验通过");

    // restore 的 manifest 读取依赖 Python 打开 MSYS 路径；Windows 开发机的
    // 原生 Python 不认 /c/... 路径（Linux CI 恒可）。restore 全流程在 CI
    // （Linux）上验证；此处 Windows 只保留 backup/verify/篡改检测。
    if (process.platform !== "win32") {
      const restored = path.join(workspace, "restored");
      expect(run("restore", [toPosix(snapPath), "--to", toPosix(restored)]).status).toBe(0);
      const restoredDb = new Database(path.join(restored, "data", "db", "capsule.sqlite"), { readonly: true });
      expect(restoredDb.prepare("SELECT storage_key FROM asset").get()).toEqual({ storage_key: "originals/a.jpg" });
      restoredDb.close();
      expect(readFileSync(path.join(restored, "data", "originals", "a.jpg"), "utf8")).toBe("photo-bytes");
      expect(existsSync(path.join(ftcRoot, "state", "locks", "restore"))).toBe(false);
    }

    // 篡改
    writeFileSync(snapPath, "corrupted");
    const corrupted = run("backup", ["verify", toPosix(snapPath)]);
    expect(corrupted.status).toBe(22);
  });

  it("an invalid new snapshot cannot replace or evict the last verified backup", () => {
    installOnce();
    expect(run("backup", [], { FTC_BACKUP_KEEP: "1" }).status).toBe(0);
    const backups = path.join(ftcRoot, "backups");
    const name = readdirSync(backups).find(file => file.endsWith(".tar.gz"))!;
    const before = readFileSync(path.join(backups, name));
    const dataDir = `${dockerLog.replace(/\.log$/u, "")}-volume`;
    writeFileSync(path.join(dataDir, "originals", "a.jpg"), "bad-original");
    const failed = run("backup", [], { FTC_BACKUP_KEEP: "1" });
    expect(failed.status, failed.stderr).toBe(22);
    expect(failed.stderr).toContain("original_checksum_mismatch");
    expect(readdirSync(backups).sort()).toEqual([name, `${name}.sha256`].sort());
    expect(readFileSync(path.join(backups, name))).toEqual(before);
    expect(dockerCalls().at(-1)).toContain("up -d --wait");
  });

  it.each(["0", "-1", "invalid"])("rejects unsafe backup retention %s before stopping services", (keep) => {
    const originalEnv = installOnce();
    const priorCalls = dockerCalls();
    writeFileSync(path.join(ftcRoot, "config", "env"), `${originalEnv}\nFTC_BACKUP_KEEP=${keep}\n`);
    const result = run("backup", []);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("FTC_BACKUP_KEEP");
    expect(dockerCalls()).toEqual(priorCalls);
  });

  it("cleanup 默认 dry-run 不删除；--apply 只清理超出保留数的快照", () => {
    installOnce();
    const backups = path.join(ftcRoot, "backups");
    for (let i = 0; i < 3; i += 1) {
      const name = `ftc-snapshot-2026090${i + 1}T000000Z-aabbccdd.tar.gz`;
      writeFileSync(path.join(backups, name), `snap-${i}`);
      writeFileSync(path.join(backups, `${name}.sha256`), `hash  ${name}`);
    }
    const dry = run("cleanup", ["--keep", "1"]);
    expect(dry.status).toBe(0);
    expect(dry.stderr).toContain("dry-run");
    expect(readdirSync(backups).length).toBe(6);

    const apply = run("cleanup", ["--apply", "--keep", "1"]);
    expect(apply.status).toBe(0);
    const remaining = readdirSync(backups).filter((f) => f.endsWith(".tar.gz"));
    expect(remaining.length).toBe(1);
  });
});

describe("互斥锁", () => {
  it.skipIf(process.platform === "win32")("different lifecycle commands share an instance lock", async () => {
    installOnce();
    const lock = path.join(ftcRoot, "state/operation.lock");
    const script = path.join(workspace, "hold-operation.sh");
    writeFileSync(script, `#!/usr/bin/env bash\nexec 8>${bashQuote(lock)}\nflock -x 8\nprintf 'locked\\n'\nread -r\n`);
    const holder = spawn("bash", [script], { stdio: ["pipe", "pipe", "pipe"] });
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout.once("data", () => resolve());
        holder.once("error", reject);
        holder.once("exit", code => reject(new Error(`lock holder exited: ${code}`)));
      });
      for (const command of ["backup", "start", "stop"]) expect(run(command, []).status).toBe(9);
    } finally {
      const exited = new Promise<void>(resolve => holder.once("exit", () => resolve()));
      holder.stdin.end();
      await exited;
    }
    expect(run("start", []).status).toBe(0);
  });
  it("锁被存活进程持有时退出 9；进程死亡后锁自动回收并继续", async () => {
    // 用 bash 自己占锁并写入它的 $$，保证 kill -0 在同一 pid 命名空间可见。
    const lockDir = toPosix(path.join(ftcRoot, "state", "locks", "backup"));
    const holderScript = path.join(workspace, "hold-lock.sh");
    writeFileSync(
      holderScript,
      ["#!/usr/bin/env bash", `mkdir -p '${lockDir}'`, `echo $BASHPID > '${lockDir}/pid'`, "sleep 10", ""].join("\n"),
    );
    const holder = spawn("bash", [holderScript], { stdio: "ignore" });
    try {
      // 等占锁脚本写入 pid。
      const pidFile = path.join(ftcRoot, "state", "locks", "backup", "pid");
      for (let i = 0; i < 100 && !existsSync(pidFile); i += 1) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
      const blocked = run("backup", []);
      expect(blocked.status).toBe(9);
      expect(blocked.stderr).toContain("正在运行");
    } finally {
      holder.kill("SIGKILL");
      // 异步等待让 node 回收子进程，避免僵尸 pid 让 kill -0 误判存活。
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    // 持有进程已死：锁应被自动回收（不再报"正在运行"）。
    const recovered = run("backup", []);
    expect(recovered.status).not.toBe(9);
    expect(recovered.stderr).not.toContain("正在运行");
  });
});

describe("ftc upgrade 失败分级", () => {
  it("--check 只读输出计划（含通道与注册表判定）", () => {
    installOnce();
    const result = run("upgrade", ["--check", "--image", "ghcr.io/yepixpert/family-time-capsule:1.0.0-dev.1"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("升级计划");
    expect(result.stdout).toContain("停机说明");
    expect(result.stdout).toContain("注册表");
    expect(result.stdout).toContain("exploration");
  });

  it("镜像拉取失败（A 类）：旧版不动，退出 11", () => {
    installOnce();
    const before = dockerCalls().filter((c) => c.includes("up -d")).length;
    const failFlag = path.join(workspace, "fail-pull");
    writeFileSync(failFlag, "1");
    // 探索版 1.3.0-alpha.1 → 正式主线 dev：注册表允许的迁移路径。
    const result = run("upgrade", ["--image", "ghcr.io/yepixpert/family-time-capsule:1.0.0-dev.1"], {
      FAKE_DOCKER_FAIL_PULL: failFlag,
    });
    expect(result.status).toBe(11);
    expect(result.stderr).toContain("A 类");
    const after = dockerCalls().filter((c) => c.includes("up -d")).length;
    expect(after).toBe(before);
  });

  it("未注册版本被来源白名单拒绝（exit 26），不进入拉取阶段", () => {
    installOnce();
    const before = dockerCalls().length;
    const result = run("upgrade", ["--image", "ghcr.io/yepixpert/family-time-capsule:9.9.9"]);
    expect(result.status).toBe(26);
    expect(result.stderr).toContain("注册表");
    expect(dockerCalls().length).toBe(before);
  });

  it("digest 固定引用缺 --version 时拒绝（不从 digest 截取伪版本）", () => {
    installOnce();
    const result = run("upgrade", [
      "--image", "ghcr.io/yepixpert/family-time-capsule@sha256:88f2b1c0aa11e1f3f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f80912a3",
    ]);
    expect(result.status).toBe(26);
    expect(result.stderr).toContain("--version");
  });

  it("正式主线不能升级回探索期版本（era 白名单，exit 26）", () => {
    installOnce();
    // 把当前版本手工置为正式主线（模拟已升级）
    writeFileSync(path.join(ftcRoot, "state", "current_version"), "1.0.0-dev.1");
    const result = run("upgrade", ["--image", "ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1"]);
    expect(result.status).toBe(26);
    expect(result.stderr).toContain("探索");
  });
});

describe("ftc rollback", () => {
  it("当前部署已接受写入时拒绝静默回退（exit 25），--accept-data-loss 才继续", () => {
    installOnce();
    const deployments = readdirSync(path.join(ftcRoot, "state", "deployments"));
    const current = deployments[0];
    // 手工标记为已接受写入（模拟开放服务后）
    const depFile = path.join(ftcRoot, "state", "deployments", current);
    const content = readFileSync(depFile, "utf8").replace("accepted_writes=unknown", "accepted_writes=true");
    writeFileSync(depFile, content);
    // 再造一个"旧部署"可回退
    const oldDep = "20260101T000000Z-old0000";
    writeFileSync(
      path.join(ftcRoot, "state", "deployments", `${oldDep}.env`),
      `id=${oldDep}\nversion=1.2.0\nimage=ghcr.io/yepixpert/family-time-capsule:1.2.0\ncreated_at=2026-01-01\naccepted_writes=true\n`,
    );
    const result = run("rollback", ["--to", oldDep, "--yes"]);
    expect(result.status).toBe(25);
    expect(result.stderr).toContain("拒绝静默执行");
    expect(result.stderr).toContain("--accept-data-loss");
    expect(content).toContain("accepted_writes=true");
  });
});

describe("isolated deployment lifecycle", () => {
  const targetImage = "ghcr.io/yepixpert/family-time-capsule:1.0.0-dev.1";
  function envValue(key: string) {
    return readFileSync(path.join(ftcRoot, "config/env"), "utf8").split("\n").find(line => line.startsWith(`${key}=`))!.slice(key.length + 1);
  }
  function volumePath(volume = "capsule-data") {
    const base = `${dockerLog.replace(/\.log$/u, "")}-volume`;
    return volume === "capsule-data" ? base : `${base}-${volume}`;
  }
  function marker(volume = "capsule-data") {
    const db = new Database(path.join(volumePath(volume), "db/capsule.sqlite"), { readonly: true });
    try { return db.prepare("SELECT value FROM lifecycle_marker").get(); }
    finally { db.close(); }
  }
  function prepare() {
    installOnce();
    const db = new Database(path.join(volumePath(), "db/capsule.sqlite"));
    db.exec("CREATE TABLE lifecycle_marker(value TEXT); INSERT INTO lifecycle_marker VALUES ('original');");
    db.close();
    const old = readFileSync(path.join(ftcRoot, "state/current_deployment"), "utf8");
    const sql = path.join(workspace, "candidate.sql");
    writeFileSync(sql, "UPDATE lifecycle_marker SET value='candidate-migrated';");
    const log = path.join(workspace, "state-log.jsonl");
    return { old, sql, log, env: { FAKE_DOCKER_CANDIDATE_SQL: toPosix(sql), FAKE_DOCKER_STATE_LOG: toPosix(log) } };
  }
  function states(log: string): { image: string; volume: string; phase: string; accepted: string }[] {
    return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  }
  function upgraded() {
    const fixture = prepare();
    const result = run("upgrade", ["--image", targetImage], fixture.env);
    expect(result.stderr, result.stdout).not.toContain("[ftc:error]");
    expect(result.status).toBe(0);
    const snapshot = path.basename(readFileSync(path.join(ftcRoot, "state/upgrade_snapshot"), "utf8"));
    return { ...fixture, snapshot, currentVolume: envValue("FTC_DATA_VOLUME") };
  }
  function prepareRollback(fixture: ReturnType<typeof upgraded>) {
    const result = run("rollback", ["--to", fixture.old, "--snapshot", fixture.snapshot, "--accept-data-loss"]);
    expect(result.stderr).toContain("尚未启用");
    expect(result.status).toBe(28);
    return readFileSync(path.join(ftcRoot, "state/pending_rollback"), "utf8");
  }

  it("keeps writers stopped throughout snapshot and candidate verification, then opens one verified pair", () => {
    const fixture = upgraded();
    expect(fixture.currentVolume).not.toBe("capsule-data");
    expect(marker()).toEqual({ value: "original" });
    expect(marker(fixture.currentVolume)).toEqual({ value: "candidate-migrated" });
    expect(states(fixture.log)).toEqual([{ image: envValue("FTC_IMAGE"), volume: fixture.currentVolume, phase: "upgrade-open", accepted: "true" }]);
    const calls = dockerCalls();
    const candidate = calls.find(call => call.includes("run --detach"))!;
    expect(candidate).toContain("--network none");
    expect(candidate).not.toContain("--publish");
    expect(candidate).not.toContain("worker.mjs");
  });

  it("candidate migration failure can restart the unchanged original volume, never the migrated candidate", () => {
    const fixture = prepare();
    const failure = path.join(workspace, "candidate-failure"); writeFileSync(failure, "1");
    const result = run("upgrade", ["--image", targetImage], { ...fixture.env, FAKE_DOCKER_FAIL_CANDIDATE: failure });
    expect(result.status).toBe(14);
    const candidate = readFileSync(path.join(ftcRoot, "state/upgrade_candidate_volume"), "utf8");
    expect(marker()).toEqual({ value: "original" });
    expect(marker(candidate)).toEqual({ value: "candidate-migrated" });
    expect(envValue("FTC_DATA_VOLUME")).toBe("capsule-data");
    expect(states(fixture.log).map(row => [row.phase, row.volume])).toEqual([["upgrade-recover-original", "capsule-data"]]);
  });

  it("public startup failure preserves the new pair and records possible writes before it starts", () => {
    const fixture = prepare();
    const failure = path.join(workspace, "public-failure"); writeFileSync(failure, "1");
    const result = run("upgrade", ["--image", targetImage], { ...fixture.env, FAKE_DOCKER_FAIL_PUBLIC_UP: failure });
    expect(result.status).toBe(13);
    expect(envValue("FTC_DATA_VOLUME")).not.toBe("capsule-data");
    expect(marker()).toEqual({ value: "original" });
    expect(states(fixture.log)).toHaveLength(1);
    expect(states(fixture.log)[0]).toMatchObject({ phase: "upgrade-open", accepted: "true", volume: envValue("FTC_DATA_VOLUME") });
    expect(readFileSync(path.join(ftcRoot, "state/phase"), "utf8")).toBe("upgrade-open-failed");
    const calls = dockerCalls();
    expect(calls.at(-2)).toContain("compose version");
    expect(calls.at(-1)).toContain("stop app worker");
  });

  it("rollback prepares without switching, blocks accidental reopening, and activates the restored volume only after review", () => {
    const fixture = upgraded();
    const plan = prepareRollback(fixture);
    expect(envValue("FTC_DATA_VOLUME")).toBe(fixture.currentVolume);
    expect(marker(fixture.currentVolume)).toEqual({ value: "candidate-migrated" });
    expect(run("start", []).status).toBe(28);
    expect(run("backup", []).status).toBe(28);
    expect(runFtc(["ai", "disable"]).status).toBe(1);
    expect(run("rollback", ["--activate", plan, "--accept-data-loss"]).status).toBe(28);
    const result = run("rollback", ["--activate", plan, "--accept-data-loss", "--access-reviewed"]);
    expect(result.stderr).toContain("回滚完成");
    expect(result.status).toBe(0);
    const restored = envValue("FTC_DATA_VOLUME");
    expect(restored).not.toBe(fixture.currentVolume);
    expect(restored).not.toBe("capsule-data");
    expect(marker(restored)).toEqual({ value: "original" });
    expect(marker(fixture.currentVolume)).toEqual({ value: "candidate-migrated" });
    expect(existsSync(path.join(ftcRoot, "state/pending_rollback"))).toBe(false);
  });

  it("canceling a prepared rollback restarts the original pair without applying the snapshot", () => {
    const fixture = upgraded();
    const plan = prepareRollback(fixture);
    expect(run("rollback", ["--abort", plan]).status).toBe(0);
    expect(envValue("FTC_DATA_VOLUME")).toBe(fixture.currentVolume);
    expect(marker(fixture.currentVolume)).toEqual({ value: "candidate-migrated" });
    expect(existsSync(path.join(ftcRoot, "state/pending_rollback"))).toBe(false);
  });

  it("refuses an unpaired snapshot and a plan prepared against a different active configuration", () => {
    const fixture = upgraded();
    const oldPath = path.join(ftcRoot, "state/deployments", `${fixture.old}.env`);
    const oldRecord = readFileSync(oldPath, "utf8");
    writeFileSync(oldPath, oldRecord.replace("version=1.3.0-alpha.1", "version=1.2.0"));
    expect(run("rollback", ["--to", fixture.old, "--snapshot", fixture.snapshot, "--accept-data-loss"]).status).toBe(26);
    expect(envValue("FTC_DATA_VOLUME")).toBe(fixture.currentVolume);
    writeFileSync(oldPath, oldRecord);
    const plan = prepareRollback(fixture);
    const envPath = path.join(ftcRoot, "config/env");
    writeFileSync(envPath, readFileSync(envPath, "utf8") + "# changed after prepare\n");
    expect(run("rollback", ["--activate", plan, "--accept-data-loss", "--access-reviewed"]).status).toBe(28);
    expect(envValue("FTC_DATA_VOLUME")).toBe(fixture.currentVolume);
  });
});
