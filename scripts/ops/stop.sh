#!/usr/bin/env bash
# ftc stop —— 停止本项目服务（保留卷与数据；不影响其他容器）。
set -euo pipefail
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"
ftc_lock lifecycle
phase_set "stopping"
compose_cmd stop
phase_clear
note "已停止。数据卷 $FTC_DATA_VOLUME 保持不变；ftc start 可再启动。"
