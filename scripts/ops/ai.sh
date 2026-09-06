#!/usr/bin/env bash
# AI 操作由受限 Python 参数解析器处理；不 source/eval 用户配置。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$HERE/lib/ai.py" "$@"
