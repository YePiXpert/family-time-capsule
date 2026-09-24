import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
/**
 * 端到端测试用的真实服务端子进程：临时 SQLite 与对象库、随机端口、去掉代理变量。
 * 需要 server/ 已 npm ci（CI 的 quality 作业多装一次）。
 */
export const serverDir = path.resolve(__dirname, "..", "..", "..", "server");
export type E2EServer = {
  base: string;
  root: string;
  logs: string[];
  /** 部署端的一次性激活码（与服务端同一个库）。 */
  activationCode(): string;
  stop(): Promise<void>;
};
export async function startServer(
  /** 起服务前先在库文件里摆好旧数据（例如 1.0.8 的主人库）。 */
  prepare?: (dbFile: string) => void,
): Promise<E2EServer> {
  if (!fs.existsSync(path.join(serverDir, "node_modules")))
    throw new Error("server/node_modules 不在：先在 server/ 里 npm ci，再跑端到端。");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anan-e2e-server-"));
  fs.writeFileSync(path.join(root, "cpa-key"), "unused-in-e2e\n");
  prepare?.(path.join(root, "ai.sqlite"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}/api/v1`;
  const clean = { ...process.env };
  for (const name of Object.keys(clean))
    if (/^(https?|all)_proxy$/i.test(name)) delete clean[name];
  const logs: string[] = [];
  const child: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
    cwd: serverDir,
    env: {
      ...clean,
      DB_FILE: path.join(root, "ai.sqlite"),
      BACKUP_DIR: path.join(root, "backup"),
      AI_MODEL: "gpt-6-astra",
      TRANSCRIBE_MODEL: "mimo-v2.5-asr",
      UPSTREAM_BASE_URL: "https://upstream.example.invalid/v1",
      UPSTREAM_KEY_FILE: path.join(root, "cpa-key"), // Fake; e2e never calls AI.
      PORT: String(port),
      SOURCE_SHA: "e2e",
      NODE_NO_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => logs.push(d.toString()));
  child.stderr?.on("data", (d: Buffer) => logs.push(d.toString()));
  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`服务端子进程退出了：\n${logs.join("")}`);
    try {
      if ((await fetch(`${base.replace(/\/api\/v1$/, "")}/healthz`)).ok) break;
    } catch {
      // 还没起来
    }
    if (Date.now() > deadline) throw new Error(`服务端没起来：\n${logs.join("")}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    base,
    root,
    logs,
    activationCode() {
      const printed = execFileSync(process.execPath, ["src/manage.ts", "activation"], {
        cwd: serverDir,
        env: { ...clean, DB_FILE: path.join(root, "ai.sqlite"), NODE_NO_WARNINGS: "1" },
        encoding: "utf8",
      });
      const code = /[0-9A-Z]{5}(?:-[0-9A-Z]{5}){4}/.exec(printed)?.[0];
      if (!code) throw new Error(`没拿到激活码：${printed}`);
      return code;
    },
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM");
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
        if (child.exitCode === null) child.kill("SIGKILL");
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
