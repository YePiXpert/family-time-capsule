#!/usr/bin/env bash
# ftc deploy —— 以固定镜像应用一个发布（install/upgrade 内部也走该路径；独立用于重放）。
# M0-V：目标版本必须来自发布注册表或 --version 显式声明；digest 引用不再截取伪版本。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

IMAGE=""
VERSION_FLAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION_FLAG="$2"; shift 2 ;;
    --help|-h) sed -n '2,3p' "$0"; exit 0 ;;
    *) [[ -z "$IMAGE" && "$1" != -* ]] && IMAGE="$1" || die "未知参数：$1" 2 ;;
  esac
done
[[ -n "$IMAGE" ]] || die "用法：ftc deploy <image[:tag|@digest]> [--version <注册表内版本>]" 2
load_env || die "尚未安装。" 2

if ! RESOLVED="$(resolve_release "$IMAGE" "$VERSION_FLAG")"; then
  die "无法从发布注册表解析版本（镜像 $IMAGE）：digest 引用需 --version；未知版本需先登记 lib/releases.json。" 26
fi
DEPLOY_VERSION="$(printf '%s' "$RESOLVED" | "$(ftc_python)" -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
CURRENT_VERSION="$(state_get current_version || echo unknown)"
if [[ "$CURRENT_VERSION" != "unknown" && "$CURRENT_VERSION" != "$DEPLOY_VERSION" ]]; then
  assert_release_transition "$CURRENT_VERSION" "$DEPLOY_VERSION" "$IMAGE" ""
fi

ftc_lock deploy
phase_set "deploy-validate"
sed -i.bak "s#^FTC_IMAGE=.*#FTC_IMAGE=$IMAGE#" "$FTC_ENV_FILE" && rm -f "$FTC_ENV_FILE.bak"
audit_compose_ports

phase_set "deploy-up"
compose_cmd pull --quiet || { phase_clear; die "镜像拉取失败，未做变更。" 11; }
compose_cmd up -d --wait || { phase_set "deploy-failed"; die "启动失败：ftc doctor。" 13; }

record_deployment "$(new_deployment_id)" "$DEPLOY_VERSION" "$IMAGE"
state_set current_version "$DEPLOY_VERSION"
mark_accepted_writes
phase_clear
note "已部署 $DEPLOY_VERSION（镜像 $IMAGE）。"
