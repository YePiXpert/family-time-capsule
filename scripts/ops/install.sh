#!/usr/bin/env bash
# ftc install —— 首次安装与二次检查（M5）。
# 绝不覆盖已有数据：检测到既有安装时进入只读检查并提示后续操作。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

DOMAIN=""
MODE=""
PORT=""
IMAGE=""
SKIP_HTTPS_CHECK=0
ASSUME_YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --skip-https-check) SKIP_HTTPS_CHECK=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --help|-h)
      sed -n '2,8p' "$0"; usage; exit 0 ;;
    *) die "未知参数：$1（见 --help）" 2 ;;
  esac
done

ftc_lock install
ensure_layout

# ---------------------------------------------------------------- 1 环境检查
log "检查运行环境……"
OS_ID="$(. /etc/os-release 2>/dev/null && echo "${ID:-unknown}" || echo unknown)"
OS_VERSION="$(. /etc/os-release 2>/dev/null && echo "${VERSION_ID:-unknown}" || echo unknown)"
ARCH="$(uname -m)"
note "系统：$OS_ID $OS_VERSION（$ARCH）。已验证平台：Debian 12/13、Ubuntu 22.04/24.04 的 x86_64；其他组合未测试，仅继续安装不代表承诺支持。"
if [[ "${FTC_SKIP_ROOT_CHECK:-0}" != "1" ]]; then
  [[ $EUID -eq 0 ]] || die "请以 root 运行（sudo）。"
fi
require_cmd docker
require_cmd python3

if ! docker info >/dev/null 2>&1; then
  cat >&2 <<'EOF'
[ftc:info] Docker daemon 未运行。可按官方文档安装/启动：
  https://docs.docker.com/engine/install/ubuntu/  或 /engine/install/debian/
本工具不会自动安装 Docker、不修改 daemon.json、不添加镜像源。
EOF
  die "Docker 不可用。" 127
fi
compose version >/dev/null 2>&1 || die "未检测到 Docker Compose v2。" 127
check_disk_free_mb "$FTC_ROOT" 2048

# ------------------------------------------------------- 2 已有安装检测/接管
if [[ -d "$FTC_RELEASES_DIR/current" && -f "$FTC_ENV_FILE" ]]; then
  note "检测到已有安装（$(state_get current_version || echo 未知版本)）。"
  note "本命令不会覆盖任何数据。日常操作请使用：ftc status / ftc upgrade / ftc backup。"
  note "如需从旧目录接管，请先停止旧实例并人工迁移 $FTC_ROOT；工具不自动猜测数据卷归属。"
  exit 0
fi
if docker volume ls --format '{{.Name}}' 2>/dev/null | grep -qx "${FTC_DATA_VOLUME}"; then
  warn "已存在同名数据卷 $FTC_DATA_VOLUME。"
  warn "若它属于本项目的历史部署，请改用迁移/接管流程（人工确认卷归属后将其写回 env）后重跑；工具不会挂载未确认归属的卷。"
  die "检测到可能冲突的数据卷，已中止。" 10
fi

# ---------------------------------------------------------------- 3 交互计划
if [[ -z "$MODE" ]]; then
  if [[ $ASSUME_YES -eq 1 ]]; then die "非交互模式必须提供 --mode caddy|loopback。" 2; fi
  read -r -p "网络模式：新机器自动 HTTPS 选 caddy；已有 Nginx/Caddy 反代选 loopback [caddy/loopback]：" MODE
fi
case "$MODE" in
  caddy|loopback) ;;
  *) die "--mode 只支持 caddy 或 loopback。" 2 ;;
esac
if [[ -z "$DOMAIN" ]]; then
  if [[ $ASSUME_YES -eq 1 ]]; then die "非交互模式必须提供 --domain。" 2; fi
  read -r -p "家庭空间域名（如 capsule.example.com）：" DOMAIN
fi
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || die "域名格式不正确。" 2
if [[ -z "$PORT" && "$MODE" == "loopback" ]]; then
  PORT="${FTC_LOOPBACK_PORT:-3001}"
fi
if [[ -z "$IMAGE" ]]; then
  if [[ $ASSUME_YES -eq 1 ]]; then die "非交互模式必须提供 --image（固定版本的已验证镜像）。" 2; fi
  read -r -p "应用镜像（默认 ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1）：" IMAGE
  IMAGE="${IMAGE:-ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1}"
fi

cat <<EOF

安装计划
  模式          $MODE
  域名          $DOMAIN
  环回端口      ${PORT:-（caddy 模式不使用）}
  镜像          $IMAGE
  安装根目录    $FTC_ROOT
  数据卷        $FTC_DATA_VOLUME（新建，绝不复用未确认卷）
EOF
if [[ $ASSUME_YES -ne 1 ]]; then
  read -r -p "确认执行以上计划？输入 yes 继续：" CONFIRM
  [[ "$CONFIRM" == "yes" ]] || die "已取消。" 1
fi

# ------------------------------------------------------------ 4 密钥与配置
phase_set "generate-config"
if [[ -f "$FTC_ENV_FILE" ]]; then
  note "env 已存在，保留原密钥与配置（不重置 AUTH_SECRET）。"
else
  AUTH_SECRET="$(generate_secret)"
  INITIAL_SETUP_TOKEN="$(generate_secret)"
  {
    printf 'BETTER_AUTH_URL=https://%s\n' "$DOMAIN"
    printf 'FTC_IMAGE=%s\n' "$IMAGE"
    printf 'FTC_PROJECT_NAME=%s\n' "$FTC_PROJECT_NAME"
    printf 'FTC_DATA_VOLUME=%s\n' "$FTC_DATA_VOLUME"
    printf 'AUTH_SECRET=%s\n' "$AUTH_SECRET"
    printf 'INITIAL_SETUP_TOKEN=%s\n' "$INITIAL_SETUP_TOKEN"
    printf 'AI_PROVIDER=disabled\n'
  } > "$FTC_ENV_FILE"
  chmod 600 "$FTC_ENV_FILE"
  printf '%s\n' "$INITIAL_SETUP_TOKEN" > "$FTC_CONFIG_DIR/initial-setup-token"
  chmod 600 "$FTC_CONFIG_DIR/initial-setup-token"
  note "已生成 AUTH_SECRET 与一次性初始化令牌（受保护保存于 $FTC_CONFIG_DIR）。"
fi
load_env || true
if [[ "$MODE" == "loopback" ]]; then
  printf 'FTC_LOOPBACK_PORT=%s\n' "${FTC_LOOPBACK_PORT:-$PORT}" >> "$FTC_ENV_FILE"
fi
export FTC_PROJECT_NAME FTC_DATA_VOLUME FTC_IMAGE FTC_DOMAIN="${DOMAIN}"

RELEASE_DIR="$FTC_RELEASES_DIR/$(date -u +%Y%m%dT%H%M%SZ)-install"
mkdir -p "$RELEASE_DIR"
cp "$LIB_DIR/../templates/compose.$MODE.yml" "$RELEASE_DIR/compose.yml"
if [[ "$MODE" == "caddy" ]]; then
  cp "$LIB_DIR/../templates/Caddyfile" "$RELEASE_DIR/Caddyfile"
  cp "$LIB_DIR/../templates/maintenance.Caddyfile" "$RELEASE_DIR/maintenance.Caddyfile"
else
  sed "s/FTC_LOOPBACK_PORT/${FTC_LOOPBACK_PORT:-$PORT}/g" \
    "$LIB_DIR/../templates/nginx-ftc.conf" > "$RELEASE_DIR/nginx-ftc.conf"
  note "已生成 Nginx 片段：$RELEASE_DIR/nginx-ftc.conf（请人工审查后并入现有反代，不自动修改）。"
fi
ln -sfn "$RELEASE_DIR" "$FTC_RELEASES_DIR/current"

# ------------------------------------------------------------ 5 卷与启动
phase_set "validate-config"
audit_compose_ports

phase_set "pull-and-start"
docker volume create "$FTC_DATA_VOLUME" >/dev/null
compose_cmd pull --quiet || die "镜像拉取失败。旧数据未受影响（首次安装无数据）。" 11
compose_cmd up -d --wait || die "服务启动失败。请运行 ftc doctor 查看原因。" 13

# ------------------------------------------------------------ 6 冒烟验证
phase_set "smoke"
SMOKE_OK=1
if ! compose_cmd exec -T app node /app/ops/healthcheck.mjs >/dev/null 2>&1; then
  SMOKE_OK=0
  warn "容器内健康检查未通过。"
fi
HTTPS_OK=0
if command -v curl >/dev/null 2>&1; then
  if [[ "$MODE" == "loopback" ]]; then
    PROBE="http://127.0.0.1:${FTC_LOOPBACK_PORT:-$PORT}/api/bootstrap"
  else
    PROBE="https://$DOMAIN/api/bootstrap"
  fi
  if curl -fsS --max-time 15 "$PROBE" >/dev/null 2>&1; then HTTPS_OK=1; fi
fi
record_deployment "$(new_deployment_id)" "${FTC_TOOL_VERSION}" "$FTC_IMAGE"
state_set current_version "$FTC_TOOL_VERSION"
state_set install_mode "$MODE"
phase_clear

# ---------------------------------------------------------------- 7 收尾
cat <<EOF

安装完成（容器/API：$([[ $SMOKE_OK -eq 1 ]] && echo 通过 || echo 未通过)；外部 HTTPS：$([[ $HTTPS_OK -eq 1 ]] && echo 通过 || echo 未验证)）
  家庭空间地址    https://$DOMAIN
  初始化状态      用 ftc setup-info 查看一次性令牌（仅本机）
  下一步          在手机 App “创建我的家庭”中填入 https://$DOMAIN
EOF
if [[ $SMOKE_OK -ne 1 ]]; then
  warn "容器内健康检查未通过：请运行 ftc doctor。"
fi
if [[ $HTTPS_OK -ne 1 && $SKIP_HTTPS_CHECK -ne 1 ]]; then
  warn "外部 HTTPS 尚未就绪（DNS/防火墙/证书可能仍需配置）。本次只能算部分完成，不算成功。"
  warn "请检查域名解析与云防火墙放行 80/443 后重跑 ftc install（二次运行为只读检查）或 ftc doctor。"
  exit 3
fi
note "二次运行 install 只做检查，不清库、不换密钥、不重复建卷。"
