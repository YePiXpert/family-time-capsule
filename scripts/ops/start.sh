#!/usr/bin/env bash
# ftc start —— 启动本项目服务（不重建、不改数据）。
set -euo pipefail
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"
ftc_lock lifecycle
phase_set "starting"
compose_cmd up -d --wait
phase_clear
note "已启动。"
