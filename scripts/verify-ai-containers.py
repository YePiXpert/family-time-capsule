#!/usr/bin/env python3
"""Isolated app/worker + real Compose/HTTP checks; no live model or family data.

Run with Docker access: python3 scripts/verify-ai-containers.py --image <local-image>
Creates unique disposable projects/volumes. Never targets an existing installation.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import pty
import select
import socket
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ftc_ai", ROOT / "scripts/ops/lib/ai.py")
ai = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ai)

FAKE_HTTP = r'''
const http = require('node:http'), fs = require('node:fs');
let requests = 0;
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks); requests++;
  fs.writeFileSync('/tmp/ftc-ai-request-count', String(requests));
  res.setHeader('content-type', 'application/json');
  if (fs.existsSync('/tmp/ftc-ai-force-error')) {
    res.statusCode = 401; res.end(JSON.stringify({ error: 'DO_NOT_LOG_PROVIDER_BODY' })); return;
  }
  if (req.headers.authorization !== 'Bearer ' + process.env.AI_API_KEY) {
    res.statusCode = 403; res.end('{}'); return;
  }
  if (req.url === '/v1/audio/transcriptions') {
    if (!body.includes(Buffer.from('RIFF')) || !body.includes(Buffer.from('name="file"'))) {
      res.statusCode = 400; res.end('{}'); return;
    }
    res.end(JSON.stringify({ text: 'Hello family. This is a test recording.' })); return;
  }
  const input = JSON.parse(body.toString());
  const vision = Array.isArray(input.messages[0].content);
  if (vision && !body.includes(Buffer.from('data:image/png;base64,'))) {
    res.statusCode = 400; res.end('{}'); return;
  }
  const content = vision ? { shape: 'circle', color: 'red' } : { answer: 42 };
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }));
}).listen(3999, '127.0.0.1');
'''


def command(args, env=None, check=True, stdin=None):
    result = subprocess.run(args, env=env, input=stdin, capture_output=True, text=True, timeout=150)
    if check and result.returncode:
        raise RuntimeError("Isolated integration command failed: " + args[0] + " " + str(result.returncode))
    return result


def interactive_configure(env, synthetic_key):
    pid, fd = pty.fork()
    if pid == 0:
        os.execvpe("bash", ["bash", str(ROOT / "scripts/ops/ftc"), "ai", "configure"], env)
    output = b""
    offset = 0
    deadline = time.monotonic() + 160
    prompts = [
        ("endpoint（", "http://127.0.0.1:3999/v1"), ("接收服务名称", "Container test only"),
        ("文字模型", "fixture-text"), ("视觉模型", "fixture-vision"), ("转写模型", "fixture-audio"),
        ("token 参数", ""), ("模型支持 temperature", ""), ("文字 JSON 模式", ""),
        ("转写格式", ""), ("API Key（隐藏）：", synthetic_key),
    ]
    try:
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 1)[0]:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                output += chunk
                if prompts and prompts[0][0].encode() in output[offset:]:
                    # Wait for the complete prompt so getpass has disabled echo.
                    if not output.rstrip().endswith("：".encode()):
                        continue
                    _, value = prompts.pop(0)
                    os.write(fd, (value + "\n").encode())
                    offset = len(output)
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                assert os.waitstatus_to_exitcode(status) == 0, "Interactive configure failed"
                pid = None
                break
        assert not prompts, "Interactive configure did not finish prompts"
        assert synthetic_key.encode() not in output, "Hidden key echoed"
        assert "配置与健康检查完成".encode() in output, "Configure health gate failed"
    finally:
        os.close(fd)
        if pid:
            done, _ = os.waitpid(pid, os.WNOHANG)
            if not done:
                os.kill(pid, 15)
                os.waitpid(pid, 0)


def verify(mode, image):
    project = "ftc14-ai-test-" + uuid.uuid4().hex[:12]
    volume = project + "-data"
    with tempfile.TemporaryDirectory(prefix=project + "-") as directory:
        root = Path(directory)
        (root / "config").mkdir(mode=0o700)
        (root / "state").mkdir(mode=0o700)
        release = root / "releases/current"
        release.mkdir(parents=True)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        original = (ROOT / f"scripts/ops/templates/compose.{mode}.yml").read_text()
        # Simulate an existing deployment whose active template predates AI vars.
        legacy = "\n".join(line for line in original.split("\n") if not line.strip().startswith("AI_"))
        (release / "compose.yml").write_text(legacy)
        baseline = f"FTC_PROJECT_NAME={project}\nFTC_DATA_VOLUME={volume}\nFTC_IMAGE={image}\nFTC_LOOPBACK_PORT={port}\nFTC_DOMAIN=isolated.invalid\nAUTH_SECRET=fictional-integration-auth-secret-0123456789\nBETTER_AUTH_URL=http://localhost:3000\nAI_PROVIDER=disabled\n"
        ai.atomic_write(root / "config/env", baseline)
        env = {**os.environ, "FTC_ROOT": str(root)}
        install = ai.Installation(root)
        command(["docker", "volume", "create", volume])
        try:
            install.run(["up", "-d", "--no-deps", "--wait", "--wait-timeout", "90", "app", "worker"])
            key = "synthetic'quote\"$DOLLAR`literal`$(literal)\\tail"
            interactive_configure(env, key)
            assert (root / "config/env").stat().st_mode & 0o777 == 0o600
            assert baseline.split("AUTH_SECRET=")[1].splitlines()[0] in (root / "config/env").read_text()
            if mode == "caddy":
                assert (release / "compose.yml").read_text().split("  proxy:")[1] == original.split("  proxy:")[1]
                assert not install.run(["ps", "-q", "proxy"]).strip(), "Unexpected proxy started"
            install.run(["exec", "-T", "app", "node", "-e", "require('node:fs').writeFileSync('/tmp/ftc-ai-http.cjs', require('node:fs').readFileSync(0))"], FAKE_HTTP)
            install.run(["exec", "-d", "app", "node", "/tmp/ftc-ai-http.cjs"])
            for capability in ("text", "vision", "transcription"):
                result = command(["bash", str(ROOT / "scripts/ops/ftc"), "ai", "test", "--capability", capability], env)
                assert "测试通过" in result.stdout
                assert key not in result.stdout + result.stderr
            count = install.run(["exec", "-T", "app", "cat", "/tmp/ftc-ai-request-count"]).strip()
            assert count == "3"
            command(["bash", str(ROOT / "scripts/ops/ftc"), "ai", "status"], env)
            assert install.run(["exec", "-T", "app", "cat", "/tmp/ftc-ai-request-count"]).strip() == count, "Status sent a request"
            install.run(["exec", "-T", "app", "touch", "/tmp/ftc-ai-force-error"])
            failed = command(["bash", str(ROOT / "scripts/ops/ftc"), "ai", "test", "--capability", "text"], env, check=False)
            assert failed.returncode != 0 and "HTTP 401" in failed.stderr
            assert "DO_NOT_LOG_PROVIDER_BODY" not in failed.stdout + failed.stderr
            assert install.run(["exec", "-T", "app", "cat", "/tmp/ftc-ai-request-count"]).strip() == "4", "Unbounded automatic retries"
            install.run(["restart", "app", "worker"])
            status = command(["bash", str(ROOT / "scripts/ops/ftc"), "ai", "status"], env)
            assert "一致" in status.stdout and "密钥已配置" in status.stdout
            command(["bash", str(ROOT / "scripts/ops/ftc"), "ai", "disable"], env)
            status = command(["bash", str(ROOT / "scripts/ops/ftc"), "ai", "status"], env)
            assert "已关闭" in status.stdout and "worker 心跳：可用" in status.stdout
            assert len(install.run(["ps", "--services", "--status", "running"]).splitlines()) == 2
            install.run(["exec", "-T", "app", "node", "/app/ops/smoke-deployment.mjs"])
            print(json.dumps({"mode": mode, "passed": True, "realAppWorker": True, "realHttpFixtureCalls": 4, "liveProvider": False, "publicProxyTested": False}, ensure_ascii=False), flush=True)
        finally:
            # Only resources created by this invocation are eligible for cleanup.
            install.run(["down", "--timeout", "10"])
            command(["docker", "volume", "rm", volume])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    args = parser.parse_args()
    for selected in ("loopback", "caddy"):
        verify(selected, args.image)
