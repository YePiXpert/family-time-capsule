#!/usr/bin/env bash
# ftc restore <backup.tar.gz> --to <empty-target-dir>（M6）。
# 默认恢复到全新空目标，不覆盖生产；先整体校验再落盘。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

SNAP=""
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) TARGET="$2"; shift 2 ;;
    --help|-h) sed -n '2,4p' "$0"; exit 0 ;;
    *) SNAP="$1"; shift ;;
  esac
done
[[ -n "$SNAP" && -n "$TARGET" ]] || die "用法：ftc restore <backup.tar.gz> --to <empty-target-dir>" 2
[[ -f "$SNAP" ]] || die "备份不存在：$SNAP" 2
[[ -f "$SNAP.sha256" ]] || die "缺少 SHA256 文件，拒绝恢复。" 2

mkdir -p "$TARGET"
if [[ -n "$(ls -A "$TARGET" 2>/dev/null)" ]]; then
  die "目标目录不是空的：$TARGET。恢复只写入全新目标，绝不覆盖生产。" 24
fi

ftc_lock restore
ensure_layout

# 1 校验整包
bash "$LIB_DIR/../backup.sh" verify "$SNAP"

# 2 staging 解压 + 路径安全检查
STAGING="$(mktemp -d "$FTC_BACKUP_DIR/.restore-XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT
tar -xzf "$SNAP" -C "$STAGING"
[[ -f "$STAGING/manifest.json" && -f "$STAGING/data.tar" ]] || die "包结构不完整（缺少 manifest 或 data.tar）。" 22
KIND="$(python3 -c 'import json;print(json.load(open("'"$STAGING"'/manifest.json"))["kind"])' 2>/dev/null || echo unknown)"
[[ "$KIND" == "ftc-instance-snapshot" ]] || die "这不是实例快照（kind=$KIND）。便携家庭档案请走应用内恢复流程。" 22
tar -tf "$STAGING/data.tar" | grep -E '(^\.\./|^/|^$$)' && die "数据包存在绝对路径或路径穿越，拒绝。" 22 || true

# 3 校验通过后写入空目标
mkdir -p "$TARGET/data" "$TARGET/config"
tar -xf "$STAGING/data.tar" -C "$TARGET/data"
cp "$STAGING/env" "$TARGET/config/env"
chmod 700 "$TARGET/config"; chmod 600 "$TARGET/config/env"

note "恢复完成（隔离目标）：$TARGET"
note "目标内含账号状态与原实例配置（含 BETTER_AUTH_URL）。跨服务器恢复时请人工核对新域名后再启动。"
note "启动示例：FTC_ROOT=$TARGET ftc install（检测到 env 会保留配置）或手工 compose。"
