#!/usr/bin/env bash
# ftc deploy —— 以固定镜像应用一个发布（install/upgrade 内部也走该路径；独立用于重放）。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

IMAGE="${1:-}"
[[ -n "$IMAGE" ]] || die "用法：ftc deploy <image[:tag|@digest]>" 2
load_env || die "尚未安装。" 2

ftc_lock deploy
phase_set "deploy-validate"
sed -i.bak "s#^FTC_IMAGE=.*#FTC_IMAGE=$IMAGE#" "$FTC_ENV_FILE" && rm -f "$FTC_ENV_FILE.bak"
audit_compose_ports

phase_set "deploy-up"
compose_cmd pull --quiet || { phase_clear; die "镜像拉取失败，未做变更。" 11; }
compose_cmd up -d --wait || { phase_set "deploy-failed"; die "启动失败：ftc doctor。" 13; }

record_deployment "$(new_deployment_id)" "$(printf '%s' "$IMAGE" | sed -E 's/.*://')" "$IMAGE"
mark_accepted_writes
phase_clear
note "已部署 $IMAGE。"
