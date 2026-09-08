#!/usr/bin/env python3
"""Project-scoped AI configuration. Secrets travel through files/stdin, never argv."""
import argparse
import contextlib
try:
    import fcntl
except ImportError:  # pragma: no cover — 仅 Windows 开发机；生产环境是 Linux
    fcntl = None
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid
from urllib.parse import urlsplit

AI_KEYS = (
    "AI_CONFIGURATION_ID", "AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_PROVIDER_LABEL", "AI_MODEL",
    "AI_VISION_MODEL", "AI_TRANSCRIPTION_MODEL", "AI_EMBEDDING_MODEL", "AI_REQUEST_TIMEOUT_MS",
    "AI_MAX_REQUEST_BYTES", "AI_MAX_RESPONSE_BYTES", "AI_TOKEN_PARAMETER",
    "AI_TEMPERATURE_SUPPORTED", "AI_JSON_MODE", "AI_TRANSCRIPTION_FORMAT",
    "AI_TEXT_PROFILE", "AI_VISION_PROFILE",
    "AI_DAILY_MAX_REQUESTS", "AI_DAILY_MAX_IMAGES", "AI_DAILY_MAX_AUDIO_SECONDS", "AI_ALLOWED_PRIVATE_TARGETS",
    "ASR_CONFIGURATION_ID", "ASR_BASE_URL", "ASR_API_KEY", "ASR_PROVIDER_LABEL", "ASR_MODEL",
    "ASR_LANGUAGE", "ASR_REQUEST_TIMEOUT_MS", "ASR_MAX_REQUEST_BYTES", "ASR_MAX_RESPONSE_BYTES",
)


class OperationError(Exception):
    pass


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise OperationError("参数无效。用法：ftc ai configure|status|disable|recover 或 ftc ai test --capability text|vision|transcription。")


def atomic_write(path, content):
    path = Path(path)
    if path.is_symlink():
        raise OperationError("配置文件不得为符号链接。")
    fd, temporary = tempfile.mkstemp(prefix=".ftc-ai-", dir=path.parent)
    try:
        try:
            os.fchmod(fd, 0o600)
        except AttributeError:  # Windows 开发机无 fchmod；生产环境是 Linux
            os.chmod(temporary, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None and os.path.exists(temporary):
            os.unlink(temporary)


def encode_value(value):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise OperationError("配置值过长或包含换行/控制字符，未写入。")
    # Double-quoted dotenv: escape backslashes/quotes and Compose dollar interpolation.
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('$', '$$') + '"'


def update_environment(original, values):
    if set(values) - set(AI_KEYS):
        raise OperationError("只允许更新 AI 配置。")
    # Existing AUTH_SECRET and all non-AI lines are preserved byte for byte.
    lines = original.splitlines(keepends=True)
    kept = [line for line in lines if line.split("=", 1)[0].strip() not in values]
    result = "".join(kept)
    if result and not result.endswith("\n"):
        result += "\n"
    return result + "".join(f"{key}={encode_value(value)}\n" for key, value in values.items())


def update_template(original):
    lines = original.splitlines(keepends=True)
    result = []
    service = None
    updated = set()
    index = 0
    while index < len(lines):
        line = lines[index]
        match = re.fullmatch(r"  ([a-zA-Z0-9_-]+):\s*\n?", line)
        if match:
            service = match.group(1)
        result.append(line)
        index += 1
        if service not in ("app", "worker") or line.strip() != "environment:":
            continue
        if not line.startswith("    environment:"):
            raise OperationError("有效模板使用未知 environment 格式，请保留文件并人工审查。")
        while index < len(lines) and (lines[index].startswith("      ") or not lines[index].strip()):
            if lines[index].strip().split(":", 1)[0] not in AI_KEYS:
                result.append(lines[index])
            index += 1
        for key in AI_KEYS:
            default = "disabled" if key == "AI_PROVIDER" else ""
            result.append(f"      {key}: ${{{key}:-{default}}}\n")
        updated.add(service)
    if updated != {"app", "worker"}:
        raise OperationError("有效模板缺少 app/worker 环境块，未执行重建。")
    return "".join(result)


def validate_configuration(values):
    for value in values.values():
        encode_value(value)
        if value.strip() != value:
            raise OperationError("配置值首尾不能有空白。")
    url = urlsplit(values["AI_BASE_URL"])
    if not url.hostname or url.username or url.password or url.query or url.fragment:
        raise OperationError("endpoint 必须是无账号、查询或片段的绝对地址。")
    loopback = url.hostname in ("localhost", "::1") or bool(re.fullmatch(r"127(?:\.\d{1,3}){3}", url.hostname))
    if url.scheme != "https" and not (url.scheme == "http" and loopback):
        raise OperationError("公网 endpoint 必须使用 HTTPS；不跳过证书校验。")
    if not values["AI_API_KEY"] or not any(values[key] for key in ("AI_MODEL", "AI_VISION_MODEL", "AI_TRANSCRIPTION_MODEL")):
        raise OperationError("需要 Key 和至少一项能力模型。")
    for key in ("AI_MODEL", "AI_VISION_MODEL", "AI_TRANSCRIPTION_MODEL"):
        if len(values[key]) > 256:
            raise OperationError("模型名称过长。")
    if len(values["AI_PROVIDER_LABEL"]) > 100:
        raise OperationError("服务名称过长。")
    if values["AI_PROVIDER"] == "dual":
        asr_url = urlsplit(values["ASR_BASE_URL"] or "https://api.xiaomimimo.com/v1")
        if not asr_url.hostname or asr_url.username or asr_url.password or asr_url.query or asr_url.fragment:
            raise OperationError("MiMo 语音 endpoint 必须是无账号、查询或片段的绝对地址。")
        asr_loopback = asr_url.hostname in ("localhost", "::1") or bool(re.fullmatch(r"127(?:\.\d{1,3}){3}", asr_url.hostname))
        if asr_url.scheme != "https" and not (asr_url.scheme == "http" and asr_loopback):
            raise OperationError("公网语音 endpoint 必须使用 HTTPS；不跳过证书校验。")
        if not values["ASR_API_KEY"] or not values["ASR_MODEL"]:
            raise OperationError("双路由需要 MiMo 语音 Key 与模型。")
        if values["ASR_LANGUAGE"] not in ("auto", "zh", "en"):
            raise OperationError("ASR_LANGUAGE 只能是 auto / zh / en。")
    for key, choices in {
        "AI_TOKEN_PARAMETER": ("max_tokens", "max_completion_tokens"),
        "AI_TEMPERATURE_SUPPORTED": ("true", "false"),
        "AI_JSON_MODE": ("json_object", "prompt_only"),
        "AI_TRANSCRIPTION_FORMAT": ("json", "verbose_json", "text"),
        "AI_TEXT_PROFILE": ("", "responses", "chat_completions"),
        "AI_VISION_PROFILE": ("", "responses", "chat_completions"),
    }.items():
        if values[key] not in choices:
            raise OperationError("能力协议选项无效。")
    private_targets = values.get("AI_ALLOWED_PRIVATE_TARGETS", "")
    if len(private_targets) > 8192:
        raise OperationError("内网目标清单过长。")
    for target in filter(None, private_targets.split(",")):
        approved = urlsplit(target.strip())
        if approved.scheme != "https" or not approved.hostname or approved.username or approved.password or approved.query or approved.fragment:
            raise OperationError("内网目标必须是明确的 HTTPS Base URL，不接受通配符或含密钥地址。")
    for key in ("AI_DAILY_MAX_REQUESTS", "AI_DAILY_MAX_IMAGES", "AI_DAILY_MAX_AUDIO_SECONDS"):
        if values[key] and not re.fullmatch(r"\d{1,10}", values[key]):
            raise OperationError("每日限额必须是不超过 10 位的非负整数（0=不限）。")


class Installation:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.env_file = self.root / "config/env"
        self.compose_file = self.root / "releases/current/compose.yml"
        self.state = self.root / "state"
        if not self.env_file.is_file() or not self.compose_file.is_file():
            raise OperationError("未找到本项目安装；先运行 ftc install。")
        self.process_env = {key: value for key, value in os.environ.items() if key not in AI_KEYS}
        # The existing tool writes a simple project identifier. Never evaluate the env file.
        project = re.search(r"^FTC_PROJECT_NAME=([a-z0-9][a-z0-9_-]*)$", self.env_file.read_text(), re.M)
        if not project:
            raise OperationError("缺少有效的项目名，拒绝猜测容器归属。")
        self.compose = ["docker", "compose", "-p", project.group(1), "-f", str(self.compose_file), "--env-file", str(self.env_file)]

    def run(self, args, stdin=None, timeout=120, allow_diagnostic_failure=False):
        try:
            result = subprocess.run(self.compose + args, input=stdin, capture_output=True, text=True, env=self.process_env, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise OperationError("本项目容器操作不可用或超时。") from None
        if result.returncode and not allow_diagnostic_failure:
            # Compose errors can echo dotenv values. Never emit raw stderr/stdout.
            raise OperationError("本项目容器操作失败；请检查配置、配套镜像和健康状态。原始输出已隐藏以保护凭据。")
        return result.stdout

    def effective_config(self):
        try:
            config = json.loads(self.run(["config", "--format", "json"]))
            services = config["services"]
            app = services["app"]["environment"]
            worker = services["worker"]["environment"]
            if any(str(app.get(key) or "") != str(worker.get(key) or "") for key in AI_KEYS):
                raise OperationError("app 与 worker 的 AI 配置不一致。")
            return {key: str(app.get(key) or "").replace("$$", "$") for key in AI_KEYS}
        except (KeyError, ValueError, TypeError):
            raise OperationError("无法读取本项目的有效容器配置。") from None

    def status(self):
        expected = json.dumps(self.effective_config())
        rows = {}
        for service in ("app", "worker"):
            try:
                rows[service] = json.loads(self.run(["exec", "-T", service, "node", "/app/ops/ai-diagnostics.mjs", "status", "--check-effective"], expected))
            except (ValueError, TypeError):
                raise OperationError("容器未返回有效 AI 状态；请升级 app/worker 为配套版本。") from None
        if {key: value for key, value in rows["app"].items() if key != "workerAvailable"} != {key: value for key, value in rows["worker"].items() if key != "workerAvailable"}:
            raise OperationError("运行中的 app/worker 状态不一致。")
        row = rows["app"]
        print("app / worker 有效 AI 配置：一致（已分别进入运行中的容器核对）")
        print("AI：" + ("已配置；仍需家庭同意" if row.get("enabled") else "已关闭"))
        print("密钥已配置" if row.get("keyConfigured") else "密钥未配置")
        for key in ("endpoint", "provider", "models", "requestTimeoutMs", "maxRequestBytes", "maxResponseBytes", "tokenParameter", "temperatureSupported", "jsonMode", "transcriptionFormat", "textProfile", "visionProfile", "dailyQuota"):
            if key in row:
                print(f"{key}: {json.dumps(row[key], ensure_ascii=False)}")
        print("worker 心跳：" + ("可用" if row.get("workerAvailable") else "不可用或尚未上报"))
        for capability, check in row.get("checks", {}).items():
            print(f"{capability} 检测：{check['state']}")
        return row

    def recreate(self):
        self.run(["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "90", "app", "worker"])
        self.run(["exec", "-T", "app", "node", "/app/ops/healthcheck.mjs"])
        if not self.status().get("workerAvailable"):
            raise OperationError("worker 未上报有效心跳；AI 配置操作未通过健康检查。")

    def change(self, values):
        original_env = self.env_file.read_text()
        original_compose = self.compose_file.read_text()
        current = self.effective_config()
        updates = dict(values)
        for prefix in ("AI_", "ASR_"):
            identity = prefix + "CONFIGURATION_ID"
            keys = [key for key in AI_KEYS if key.startswith(prefix) and key != identity and not key.startswith("AI_DAILY_") and key != "AI_ALLOWED_PRIVATE_TARGETS"]
            changed = any(key in values and values[key] != current.get(key, "") for key in keys)
            # Disabling/changing route mode affects both channels. An unchanged
            # secondary route retains its consent identity, including its key.
            mode_changed = "AI_PROVIDER" in values and values["AI_PROVIDER"] != current.get("AI_PROVIDER", "")
            updates[identity] = str(uuid.uuid4()) if changed or mode_changed else current.get(identity, "")
        new_env = update_environment(original_env, updates)
        new_compose = update_template(original_compose)
        recovery = self.state / "ai-recovery.json"
        if recovery.exists():
            raise OperationError("存在未完成 AI 配置操作；先执行 ftc ai recover。")
        atomic_write(recovery, json.dumps({"env": original_env, "compose": original_compose}))
        try:
            atomic_write(self.env_file, new_env)
            atomic_write(self.compose_file, new_compose)
            self.effective_config()
            self.recreate()
        except BaseException:
            atomic_write(self.env_file, original_env)
            atomic_write(self.compose_file, original_compose)
            try:
                self.run(["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "90", "app", "worker"])
                recovery.unlink()
            except OperationError:
                print("已恢复原配置文件，旧服务健康尚未恢复；执行 ftc ai recover。", file=sys.stderr)
            raise
        recovery.unlink()
        print("配置与健康检查完成。AUTH_SECRET、数据卷及反向代理保持原值。")

    def recover(self):
        recovery = self.state / "ai-recovery.json"
        if not recovery.is_file():
            raise OperationError("没有待恢复的 AI 配置事务。")
        values = json.loads(recovery.read_text())
        atomic_write(self.env_file, values["env"])
        atomic_write(self.compose_file, values["compose"])
        self.run(["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "90", "app", "worker"])
        recovery.unlink()
        print("已恢复配置操作之前的文件与服务。")

    @contextlib.contextmanager
    def lock(self):
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        with open(self.state / "ai.lock", "w") as lock:
            os.chmod(lock.name, 0o600)
            if fcntl is not None:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise OperationError("另一个 AI 配置操作正在运行。") from None
            else:
                import msvcrt

                try:
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                except OSError:
                    raise OperationError("另一个 AI 配置操作正在运行。") from None
            yield


def confirm_base_url_change(install, values):
    """换 BaseURL 的 Key 确认（AI-2）：地址换到别家时，明确告知 Key 会发给
    新地址并要求输入 confirm。旧 Key 若属于原服务商，继续使用只会被新
    服务商收到——这必须是一次显式决定，不能静默发生。"""
    try:
        current = install.effective_config()
    except OperationError as error:
        raise OperationError("无法核对当前接收地址，请先恢复配置读取；未发送 Key 或改写配置。") from error
    changes = []
    checks = [("AI_BASE_URL", values["AI_BASE_URL"])]
    if values["AI_PROVIDER"] == "dual":
        checks.append(("ASR_BASE_URL", values["ASR_BASE_URL"]))
    for key, new_url in checks:
        old_url = current.get(key) or ""
        if not old_url or not new_url:
            continue
        def recipient(value):
            parsed = urlsplit(value)
            return (parsed.scheme.lower(), (parsed.hostname or "").lower(), parsed.port or (443 if parsed.scheme == "https" else 80), parsed.path.rstrip("/") or "/v1")
        if recipient(old_url) != recipient(new_url):
            changes.append((key, old_url, new_url))
    if not changes:
        return
    for key, old_host, new_host in changes:
        print(f"{key} 将从 {old_host} 改为 {new_host}。")
    print("你输入的 API Key 会随每个模型请求发送到新地址；若旧 Key 属于原服务商，请改用新服务商的 Key。")
    reply = input("确认把 Key 发送到新地址请输入 confirm：")
    if reply.strip() != "confirm":
        raise OperationError("未确认新地址，未做任何更改。")


def configure_input():
    if not sys.stdin.isatty():
        raise OperationError("配置需要真实终端，Key 只允许隐藏输入。")
    values = {key: "" for key in AI_KEYS}
    values.update({"AI_REQUEST_TIMEOUT_MS": "30000", "AI_MAX_REQUEST_BYTES": "33554432", "AI_MAX_RESPONSE_BYTES": "4194304"})
    print("配置发生在此 VPS；不会继承开发工具的模型登录。Key 隐藏输入，不进入参数或 history。")
    print("推荐路由（1.0 默认）：文字与图片走你的 CPA（gpt-5.6-luna），语音转写走 MiMo（mimo-v2.5-asr）。")
    mode = ""
    while mode not in ("dual", "single"):
        mode = input("路由模式：dual=双路由（推荐）/ single=单一兼容端点（关闭请用 ftc ai disable） [dual]：") or "dual"
    values["AI_PROVIDER"] = "dual" if mode == "dual" else "openai-compatible"
    for key, prompt, default in (
        ("AI_BASE_URL", "官方或 CPA/兼容端点", "https://api.openai.com/v1"),
        ("AI_PROVIDER_LABEL", "接收服务名称", "我的 AI 服务"),
        ("AI_MODEL", "文字模型" + ("（回车用默认 gpt-5.6-luna）" if mode == "dual" else "（空白关闭此能力）"), "gpt-5.6-luna" if mode == "dual" else ""),
        ("AI_VISION_MODEL", "视觉模型" + ("（回车同文字模型）" if mode == "dual" else "（空白关闭此能力）"), "gpt-5.6-luna" if mode == "dual" else ""),
        ("AI_TOKEN_PARAMETER", "token 参数 max_completion_tokens / max_tokens", "max_completion_tokens"),
        ("AI_TEMPERATURE_SUPPORTED", "模型支持 temperature：true / false", "false"),
        ("AI_JSON_MODE", "文字 JSON 模式 json_object / prompt_only", "json_object"),
        ("AI_TEXT_PROFILE", "文字 API 形态 responses（官方 Luna 地址）/ chat_completions（第三方兼容）", "responses"),
        ("AI_VISION_PROFILE", "视觉 API 形态 responses / chat_completions", "responses"),
        ("AI_DAILY_MAX_REQUESTS", "每日请求上限（0=不限）", "0"),
        ("AI_DAILY_MAX_IMAGES", "每日送分析图片上限（0=不限）", "0"),
        ("AI_DAILY_MAX_AUDIO_SECONDS", "每日送转写音频秒数上限（0=不限）", "0"),
        ("AI_ALLOWED_PRIVATE_TARGETS", "明确批准的内网 HTTPS Base URL（逗号分隔；公网留空）", ""),
    ):
        values[key] = input(f"{prompt}" + (f" [{default}]" if default else "") + "：") or default
    if mode == "single":
        for key, prompt, default in (
            ("AI_TRANSCRIPTION_MODEL", "转写模型（空白关闭此能力）", ""),
            ("AI_TRANSCRIPTION_FORMAT", "转写格式 json / verbose_json / text", "json"),
        ):
            values[key] = input(f"{prompt}" + (f" [{default}]" if default else "") + "：") or default
    if not sys.stdin.isatty():
        raise OperationError("Key 只允许在终端隐藏输入；不从命令参数或普通管道读取。")
    values["AI_API_KEY"] = getpass.getpass("文字/图片端点 API Key（隐藏）：")
    if mode == "dual":
        for key, prompt, default in (
            ("ASR_BASE_URL", "MiMo 语音端点", "https://api.xiaomimimo.com/v1"),
            ("ASR_PROVIDER_LABEL", "语音接收服务名称", "MiMo 语音识别"),
            ("ASR_MODEL", "语音模型", "mimo-v2.5-asr"),
            ("ASR_LANGUAGE", "语种 auto / zh / en", "auto"),
        ):
            values[key] = input(f"{prompt}" + (f" [{default}]" if default else "") + "：") or default
        values["ASR_API_KEY"] = getpass.getpass("MiMo 语音 API Key（隐藏）：")
    validate_configuration(values)
    print("将更新本项目有效模板并重建 app/worker，短暂中断服务；不发送模型请求。")
    return values


def main():
    parser = SafeArgumentParser(description="ftc ai：配置、只读状态、内置样本能力检测、关闭与失败恢复")
    parser.add_argument("command", choices=("configure", "status", "test", "disable", "recover"))
    parser.add_argument("--capability", choices=("text", "vision", "transcription"))
    args, unknown = parser.parse_known_args()
    if unknown:
        raise OperationError("存在不支持的参数。Key 必须在交互终端隐藏输入，不能放进命令参数。")
    install = Installation(os.environ.get("FTC_ROOT", "/opt/family-time-capsule"))
    if args.command == "status":
        install.status()
        return
    if args.command == "test":
        if not args.capability:
            raise OperationError("用法：ftc ai test --capability text|vision|transcription")
        print("注意：仅发送内置非私人测试样本，最多一次模型请求，可能消耗额度。", flush=True)
        # The helper sanitizes output; never print raw compose errors.
        result = json.loads(install.run(["exec", "-T", "app", "node", "/app/ops/ai-diagnostics.mjs", "test", args.capability], allow_diagnostic_failure=True))
        if not isinstance(result, dict) or type(result.get("passed")) is not bool or result.get("capability") != args.capability:
            raise OperationError("容器未返回有效能力检测结果。")
        print(f"{args.capability}：" + ("测试通过" if result["passed"] else "测试失败"))
        if not result["passed"]:
            code = result.get("code", "capability_test_failed")
            allowed = {"ai_aborted", "ai_capability_unavailable", "ai_configuration_invalid", "ai_input_invalid", "ai_network_error", "ai_provider_http_error", "ai_response_invalid", "ai_response_too_large", "ai_timeout", "ai_quota_exceeded", "ai_execution_forbidden", "ai_dispatch_duplicate", "capability_test_failed"}
            safe_code = code if isinstance(code, str) and code in allowed else "capability_test_failed"
            status = result.get("httpStatus")
            suffix = f"，HTTP {status}" if type(status) is int and 400 <= status <= 599 else ""
            raise OperationError(f"检测失败：{safe_code}{suffix}。未自动重试；超时请求可能已计费。")
        print("用量：" + (json.dumps({key: value for key, value in result["usage"].items() if key in ("inputTokens", "outputTokens", "totalTokens") and type(value) is int and value >= 0}) if isinstance(result.get("usage"), dict) else "未知"))
        return
    with install.lock():
        if args.command == "recover":
            install.recover()
        elif args.command == "configure":
            values = configure_input()
            confirm_base_url_change(install, values)
            install.change(values)
        else:
            print("关闭后不再启动 AI 请求；已发出的远端请求不能保证撤回。媒体和出版任务仍运行。")
            install.change({"AI_PROVIDER": "disabled"})


if __name__ == "__main__":
    try:
        main()
    except (OperationError, OSError, ValueError, EOFError, KeyboardInterrupt) as error:
        print("[ftc:error] " + (str(error) if isinstance(error, OperationError) else "操作未完成；配置值不会进入错误日志。"), file=sys.stderr)
        sys.exit(1)
