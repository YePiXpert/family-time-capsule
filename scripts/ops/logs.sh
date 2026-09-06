#!/usr/bin/env bash
# ftc logs —— 查看本项目服务日志（脱敏；只影响本项目 compose 服务）。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

SERVICE="app"
TAIL=100
while [[ $# -gt 0 ]]; do
  case "$1" in
    --service) SERVICE="$2"; shift 2 ;;
    --tail) TAIL="$2"; shift 2 ;;
    --help|-h) sed -n '2,3p' "$0"; exit 0 ;;
    *) die "未知参数：$1" 2 ;;
  esac
done
case "$SERVICE" in app|worker|proxy) ;; *) die "--service 只支持 app|worker|proxy" 2 ;; esac

compose_cmd logs --no-color --tail "$TAIL" "$SERVICE" 2>/dev/null | _redact
