#!/usr/bin/env bash
# ftc 运维工具共享库（1.0.0-dev）。
# 只操作本项目自己的目录、容器、网络与卷；绝不触碰其他服务。
# shellcheck disable=SC2034

set -euo pipefail

FTC_TOOL_VERSION="$(cat "${FTC_LIB_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}/../VERSION" 2>/dev/null || echo unknown)"
FTC_PROJECT_NAME="${FTC_PROJECT_NAME:-family-time-capsule}"
FTC_ROOT="${FTC_ROOT:-/opt/family-time-capsule}"
# 归一化路径形态（Windows 风格 C:\... 与 POSIX /c/... 都能工作）。
mkdir -p "$FTC_ROOT" 2>/dev/null || true
if [[ -d "$FTC_ROOT" ]]; then
  FTC_ROOT="$(cd "$FTC_ROOT" && pwd)"
fi
FTC_CONFIG_DIR="$FTC_ROOT/config"
FTC_RELEASES_DIR="$FTC_ROOT/releases"
FTC_STATE_DIR="$FTC_ROOT/state"
FTC_BACKUP_DIR="${FTC_BACKUP_DIR:-$FTC_ROOT/backups}"
FTC_LOG_DIR="${FTC_LOG_DIR:-$FTC_ROOT/logs}"
FTC_ENV_FILE="$FTC_CONFIG_DIR/env"
FTC_LOCK_DIR="$FTC_STATE_DIR/locks"
FTC_PHASE_FILE="$FTC_STATE_DIR/phase"
FTC_DEPLOYMENTS_DIR="$FTC_STATE_DIR/deployments"
FTC_DATA_VOLUME="${FTC_DATA_VOLUME:-capsule-data}"
FTC_BACKUP_KEEP="${FTC_BACKUP_KEEP:-5}"

# ---------------------------------------------------------------- 日志与脱敏

_redact() {
  # 令牌与凭据不进入日志/诊断输出。
  sed -E \
    -e 's/(INITIAL_SETUP_TOKEN[=: ]+)[^ ]+/\1[REDACTED]/g' \
    -e 's/(AUTH_SECRET[=: ]+)[^ ]+/\1[REDACTED]/g' \
    -e 's/(AI_API_KEY[=: ]+).*/\1[REDACTED]/g' \
    -e 's/(token=)[A-Za-z0-9._-]+/\1[REDACTED]/g' \
    -e 's/(Authorization: Bearer )[A-Za-z0-9._-]+/\1[REDACTED]/g' \
    -e 's#/invite/[A-Za-z0-9_-]+#/invite/[REDACTED]#g' \
    -e 's#/contribute/[A-Za-z0-9_-]+#/contribute/[REDACTED]#g'
}

log() {
  printf '[ftc] %s\n' "$*" | _redact >&2
}

note() {
  printf '[ftc:info] %s\n' "$*" | _redact >&2
}

warn() {
  printf '[ftc:warn] %s\n' "$*" | _redact >&2
}

die() {
  local code="${2:-1}"
  printf '[ftc:error] %s\n' "$1" | _redact >&2
  exit "$code"
}

# ------------------------------------------------------------ 目录与状态文件

ensure_layout() {
  mkdir -p "$FTC_CONFIG_DIR" "$FTC_RELEASES_DIR" "$FTC_STATE_DIR" \
    "$FTC_BACKUP_DIR" "$FTC_LOG_DIR" "$FTC_LOCK_DIR" "$FTC_DEPLOYMENTS_DIR"
  chmod 700 "$FTC_CONFIG_DIR" "$FTC_STATE_DIR" "$FTC_BACKUP_DIR"
}

state_get() {
  local key="$1"
  local file="$FTC_STATE_DIR/$key"
  if [[ -f "$file" ]]; then cat "$file"; fi
}

state_set() {
  local key="$1" value="$2"
  mkdir -p "$FTC_STATE_DIR"
  printf '%s' "$value" > "$FTC_STATE_DIR/$key"
  chmod 600 "$FTC_STATE_DIR/$key" 2>/dev/null || true
}

phase_set() {
  state_set phase "$1"
  log "阶段：$1"
}

phase_clear() {
  rm -f "$FTC_PHASE_FILE"
}

# ---------------------------------------------------------------- 互斥锁

# 目录锁 + PID 存活检测：进程崩溃后锁自动失效，不永久占锁。
ftc_lock() {
  local name="${1:-global}"
  local dir="$FTC_LOCK_DIR/$name"
  mkdir -p "$FTC_LOCK_DIR"
  # AI configuration takes the exclusive side of this gate. Other operations
  # share it, including nested upgrade -> backup, while retaining their locks.
  require_cmd flock
  exec {FTC_AI_GUARD_FD}> "$FTC_STATE_DIR/ai.lock"
  chmod 600 "$FTC_STATE_DIR/ai.lock"
  flock -s -n "$FTC_AI_GUARD_FD" || die "AI 配置操作正在运行，请稍后重试。" 9
  if mkdir "$dir" 2>/dev/null; then
    printf '%s\n' "$$" > "$dir/pid"
    trap 'ftc_unlock '"$name"' || true' EXIT
    return 0
  fi
  local holder_pid
  holder_pid="$(cat "$dir/pid" 2>/dev/null || true)"
  if [[ -n "$holder_pid" ]] && ! kill -0 "$holder_pid" 2>/dev/null; then
    warn "发现失效锁（持有进程 $holder_pid 已退出），自动回收。"
    rm -rf "$dir"
    mkdir "$dir"
    printf '%s\n' "$$" > "$dir/pid"
    trap 'ftc_unlock '"$name"' || true' EXIT
    return 0
  fi
  die "另一个 ftc 操作正在运行（锁：$name，PID：${holder_pid:-unknown}）。稍后再试或检查 $FTC_STATE_DIR/locks。" 9
}

ftc_unlock() {
  local name="${1:-global}"
  local dir="$FTC_LOCK_DIR/$name"
  local holder_pid
  holder_pid="$(cat "$dir/pid" 2>/dev/null || true)"
  if [[ "$holder_pid" == "$$" ]]; then
    rm -rf "$dir"
  fi
  if [[ -n "${FTC_AI_GUARD_FD:-}" ]]; then
    exec {FTC_AI_GUARD_FD}>&-
    unset FTC_AI_GUARD_FD
  fi
}

# ---------------------------------------------------------------- 环境与命令

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1（请先安装）" 127
}

load_env() {
  if [[ ! -f "$FTC_ENV_FILE" ]]; then
    return 1
  fi
  # 只读取 KEY=VALUE 行；绝不 eval 文件内容。
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* || "$key" == AI_* ]] && continue
    case "$key" in
      *[!A-Za-z0-9_]*|'') continue ;;
    esac
    printf -v "$key" '%s' "$value" 2>/dev/null || true
  done < "$FTC_ENV_FILE"
  chmod 600 "$FTC_ENV_FILE" 2>/dev/null || true
}

compose() (
  # AI dotenv values must be interpreted once, by Compose, never shell-expanded.
  local ai_key
  while IFS= read -r ai_key; do unset "$ai_key"; done < <(compgen -v AI_ || true)
  # Compose v2 优先（docker compose），回退独立二进制。
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die "未检测到 Docker Compose v2（docker compose）。" 127
  fi
)

compose_file_active() {
  local file="$FTC_RELEASES_DIR/current/compose.yml"
  [[ -f "$file" ]] || die "未找到部署文件：$file。请先运行 ftc install。" 2
  printf '%s' "$file"
}

compose_project_args() {
  printf '%s %s' "-p $FTC_PROJECT_NAME" "-f $(compose_file_active)"
}

compose_cmd() {
  local file
  file="$(compose_file_active)"
  compose -p "$FTC_PROJECT_NAME" -f "$file" --env-file "$FTC_ENV_FILE" "$@"
}

# 校验最终解析后的 Compose 配置：app 不能公开绑定 0.0.0.0 的 3000。
audit_compose_ports() {
  local file
  file="$(compose_file_active)"
  local rendered
  rendered="$(compose -p "$FTC_PROJECT_NAME" -f "$file" --env-file "$FTC_ENV_FILE" config 2>/dev/null)" ||
    die "docker compose config 解析失败，已中止。"
  local offending=""
  if python3 -c 'print(1)' >/dev/null 2>&1; then
    local compose_json
    compose_json="$(mktemp)"
    trap 'rm -f "$compose_json"' RETURN
    compose -p "$FTC_PROJECT_NAME" -f "$file" --env-file "$FTC_ENV_FILE" config --format json >"$compose_json" 2>/dev/null
    offending="$(python3 - "$compose_json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        cfg = json.load(fh)
except Exception:
    sys.exit(0)
services = cfg.get("services", {}) or {}
for name, svc in services.items():
    for pub in (svc.get("ports") or []):
        published = str(pub.get("published", ""))
        host_ip = str(pub.get("host_ip", ""))
        target = str(pub.get("target", ""))
        if published and published != "0" and target == "3000":
            if host_ip in ("", "0.0.0.0", "::"):
                print(f"{name}:{published}->{target}")
PY
)"
  else
    # python 不可用时降级为文本审计：published 3000 或 0.0.0.0 绑定视为可疑。
    if printf '%s' "$rendered" | grep -Eq '(published[": ]+3000|0\.0\.0\.0:[0-9]+:3000)'; then
      offending="app 端口 3000 公开绑定（文本模式判定）"
    fi
    warn "python3 不可用，端口审计使用降级文本模式，请人工复核 compose 配置。"
  fi
  if [[ -n "$offending" ]]; then
    die "最终 Compose 配置仍公开暴露 app 端口：$offending（只允许代理或 127.0.0.1 绑定）。" 12
  fi
}

# ------------------------------------------------------------ 发布注册表（M0-V）

# 版本与通道的唯一可信来源是显式注册表（lib/releases.json）：
# 不从镜像 digest 截取版本、不用 sort -V 比较发布顺序。
# 测试可用 FTC_RELEASE_REGISTRY 指向独立注册表。
# Windows 开发机的 python3 可能是商店存根（退出 9009）；生产 Debian/Ubuntu
# 恒有 python3。这里解析第一个真正可用的解释器。
ftc_python() {
  if [[ -z "${FTC_PYTHON:-}" ]]; then
    local candidate
    for candidate in python3 python; do
      if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'print(1)' >/dev/null 2>&1; then
        FTC_PYTHON="$candidate"
        break
      fi
    done
    [[ -n "${FTC_PYTHON:-}" ]] || die "缺少可用的 Python 3（python3/python）。" 127
  fi
  printf '%s' "$FTC_PYTHON"
}

release_tool() {
  local lib_dir="${LIB_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  "$(ftc_python)" "$lib_dir/release_tool.py" "$@"
}

# 解析目标版本：成功时向 stdout 输出单行 JSON 并返回 0；失败非 0。
# $1 镜像引用；$2 可选显式版本（digest 固定引用必须提供）。
resolve_release() {
  local image="$1" explicit="${2:-}"
  if [[ -n "$explicit" ]]; then
    release_tool resolve --image "$image" --version "$explicit"
  else
    release_tool resolve --image "$image"
  fi
}

# 断言 from→to 迁移被注册表允许；$4 非空表示允许 stable→非 stable 显式确认。
# 拒绝时打印原因并以 26 退出（调用方直接 die）。
assert_release_transition() {
  local from="$1" to="$2" image="$3" allow_nonstable="${4:-}"
  local verdict
  if ! verdict="$(release_tool transition --from "$from" --to "$to" \
      $([[ -n "$allow_nonstable" ]] && printf '%s' --allow-nonstable-target))"; then
    die "拒绝将 $from 升级到 $to（镜像 $image）：$verdict。
注册表允许的路径见 LEGACY_TO_1_0.md 与 lib/releases.json；这不是普通 SemVer 升级判断。" 26
  fi
  printf '%s' "$verdict"
}

# ---------------------------------------------------------------- 部署记录

new_deployment_id() {
  printf '%s' "$(date -u +%Y%m%dT%H%M%SZ)-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
}

record_deployment() {
  # $1 id, $2 version, $3 image(+digest)；channel 尽力从注册表解析，
  # 注册表不认识时如实记 unknown（不阻塞，但 status/doctor 可见）。
  local id="$1" version="$2" image="$3"
  local channel="unknown"
  local resolved
  if resolved="$(release_tool resolve --image "$image" --version "$version" 2>/dev/null)"; then
    channel="$(printf '%s' "$resolved" | "$(ftc_python)" -c 'import json,sys; print(json.load(sys.stdin)["channel"])')"
  fi
  mkdir -p "$FTC_DEPLOYMENTS_DIR"
  local file="$FTC_DEPLOYMENTS_DIR/$id.env"
  {
    printf 'id=%s\n' "$id"
    printf 'version=%s\n' "$version"
    printf 'channel=%s\n' "$channel"
    printf 'image=%s\n' "$image"
    printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'accepted_writes=unknown\n'
  } > "$file"
  chmod 600 "$file"
  state_set current_deployment "$id"
}

deployment_field() {
  local id="$1" field="$2"
  local file="$FTC_DEPLOYMENTS_DIR/$id.env"
  [[ -f "$file" ]] || die "未知部署记录：$id" 2
  grep -E "^${field}=" "$file" | head -1 | cut -d= -f2-
}

mark_accepted_writes() {
  local id
  id="$(state_get current_deployment || true)"
  [[ -n "$id" ]] || return 0
  local file="$FTC_DEPLOYMENTS_DIR/$id.env"
  [[ -f "$file" ]] || return 0
  sed -i.bak 's/^accepted_writes=.*/accepted_writes=true/' "$file" && rm -f "$file.bak"
}

generate_secret() {
  openssl rand -base64 32 2>/dev/null | tr -d '\n' || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

check_disk_free_mb() {
  local path="${1:-$FTC_ROOT}"
  local needed_mb="$2"
  local available_mb
  available_mb="$(df -Pm "$path" 2>/dev/null | awk 'NR==2{print $4}' || echo 0)"
  if [[ "$available_mb" -lt "$needed_mb" ]]; then
    die "磁盘空间不足：需要约 ${needed_mb}MB，${path} 所在分区仅剩 ${available_mb}MB。不会删除任何旧备份腾空间。" 21
  fi
}

usage() {
  cat <<EOF
ftc $FTC_TOOL_VERSION —— Family Time Capsule 自托管运维工具

用法：ftc <命令> [参数]

命令：
  install                       首次安装/二次检查（绝不覆盖已有数据）
  install --version <v>         digest 固定镜像必须显式声明版本（注册表白名单校验）
  ai configure / status         AI 部署配置与运行中容器核对
  ai test --capability text|vision|transcription  内置样本能力检测（可能消耗额度）
  ai disable / recover          关闭 AI / 恢复中断的配置操作
  status                        运行版本、通道、容器、健康、磁盘与备份概览
  doctor                        深度诊断（配置、端口、HTTPS、worker 心跳）
  version                       工具与部署版本
  setup-info                    显示受保护的初始化令牌（仅本机交互使用）
  upgrade --check               只读展示升级计划与风险
  upgrade [--image <ref>] [--version <v>]
                                执行升级（快照 → 迁移 → 验证 → 开放）；
                                目标版本必须来自发布注册表（lib/releases.json）
  backup                        一致性实例快照（停写后打包数据库与原件）
  backup verify <snapshot>      校验快照完整性
  restore <backup> --to <dir>   恢复到全新空目标（不覆盖生产）
  rollback --to <deployment>    回退到历史部署（接受过写入时需显式决策）
  logs --service app|worker|proxy  查看脱敏日志
  stop / start                  停止/启动本项目服务（不删除卷）
  cleanup [--dry-run]           清理本工具拥有的旧产物（默认 dry-run）

版本与通道：目标版本只从 lib/releases.json 注册表或 --version 显式声明获得，
绝不从镜像 digest 截取；探索期（0.1.x/1.x alpha/rc）可升级到正式 1.0 主线，
正式主线不回退探索版；比较用注册表 sequence，不用 sort -V。
详见 VERSIONING.md 与 LEGACY_TO_1_0.md。

环境变量：FTC_ROOT（默认 /opt/family-time-capsule）、FTC_PROJECT_NAME、
FTC_BACKUP_KEEP（默认 5）、FTC_DATA_VOLUME。
EOF
}
