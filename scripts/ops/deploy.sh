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
# All image changes follow the same isolated snapshot/migration/activation path.
# A separate deploy implementation must never bypass upgrade safety guarantees.
exec bash "$LIB_DIR/../upgrade.sh" --image "$IMAGE" --version "${VERSION_FLAG:-}"
