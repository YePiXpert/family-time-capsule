#!/usr/bin/env bash
# ftc restore <backup.tar.gz> --to <empty-target-dir>.
# Verify in private staging, then atomically publish an isolated restore.
set -euo pipefail
umask 077

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

SNAP=""
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) [[ $# -ge 2 ]] || die "--to 需要空目标目录。" 2; TARGET="$2"; shift 2 ;;
    --help|-h) sed -n '2,3p' "$0"; exit 0 ;;
    -*) die "未知恢复参数。" 2 ;;
    *) [[ -z "$SNAP" ]] || die "只能指定一个快照。" 2; SNAP="$1"; shift ;;
  esac
done
[[ -n "$SNAP" && -n "$TARGET" ]] || die "用法：ftc restore <backup.tar.gz> --to <empty-target-dir>" 2
[[ -f "$SNAP" ]] || die "备份不存在。" 2
[[ -f "$SNAP.sha256" ]] || die "缺少 SHA256 文件，拒绝恢复。" 2
if [[ -L "$TARGET" || ( -e "$TARGET" && ! -d "$TARGET" ) ]]; then
  die "目标必须是新的普通目录，不能是链接或文件。" 24
fi
if [[ -d "$TARGET" && -n "$(ls -A "$TARGET" 2>/dev/null)" ]]; then
  die "目标目录不是空的。恢复只写入全新目标，绝不覆盖生产。" 24
fi

ftc_lock restore
ensure_layout
"$(ftc_python)" "$LIB_DIR/snapshot.py" restore "$SNAP" --to "$TARGET"
note "恢复校验完成（隔离目标）：$TARGET"
note "原件、数据库及外键已核验；旧会话、一次性验证及访客链接已失效。"
note "原配置保存在 config/env.snapshot，不能直接沿用旧数据卷或公网配置。"
note "请按 docs/BACKUP_RESTORE.md 使用 compose.restore-check.yml 独立启动核验。"
note "备份之后的撤权/删除记录尚未对账；当前结果不能自动切回公网。"
