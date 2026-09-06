#!/usr/bin/env bash
# ftc cleanup —— 清理本工具拥有的旧产物（默认 dry-run；绝不 prune 全机）。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

DRY_RUN=1
EXTRA_KEEP="${FTC_BACKUP_KEEP:-5}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --apply) DRY_RUN=0; shift ;;
    --keep) EXTRA_KEEP="$2"; shift 2 ;;
    --help|-h) sed -n '2,3p' "$0"; exit 0 ;;
    *) die "未知参数：$1" 2 ;;
  esac
done

[[ -f "$FTC_ENV_FILE" ]] || die "尚未安装。" 2
ftc_lock cleanup

cd "$FTC_BACKUP_DIR"
TOTAL="$(ls -1 ftc-snapshot-*.tar.gz 2>/dev/null | wc -l || echo 0)"
if [[ "$TOTAL" -le "$EXTRA_KEEP" ]]; then
  note "快照共 $TOTAL 份，不超过保留数 $EXTRA_KEEP：无可清理项。"
  exit 0
fi
ls -1t ftc-snapshot-*.tar.gz | tail -n +$((EXTRA_KEEP + 1)) | while read -r old; do
  if [[ $DRY_RUN -eq 1 ]]; then
    note "（dry-run）将删除：$(basename "$old") 与 .sha256"
  else
    rm -f "$old" "$old.sha256"
    note "已删除：$(basename "$old")"
  fi
done
[[ $DRY_RUN -eq 1 ]] && note "dry-run 完成；确认无误后使用 ftc cleanup --apply。"
note "本工具绝不执行 docker system prune / volume prune，不触碰其他项目。"
