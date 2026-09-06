#!/usr/bin/env bash
# ftc rollback --to <deployment-id>（M6）。
# 配对镜像与快照；已接受新写入时拒绝静默回滚，要求显式数据决策。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

TARGET_DEPLOYMENT=""
SNAPSHOT=""
FORCE_DATA_DECISION=0
ASSUME_YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) TARGET_DEPLOYMENT="$2"; shift 2 ;;
    --snapshot) SNAPSHOT="$2"; shift 2 ;;
    --accept-data-loss) FORCE_DATA_DECISION=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --help|-h) sed -n '2,4p' "$0"; exit 0 ;;
    *) die "未知参数：$1" 2 ;;
  esac
done
[[ -n "$TARGET_DEPLOYMENT" ]] || die "用法：ftc rollback --to <deployment-id> [--snapshot <file>] [--accept-data-loss]" 2

load_env || die "尚未安装。" 2
ftc_lock rollback

CURRENT_DEPLOYMENT="$(state_get current_deployment || true)"
ACCEPTED="$(deployment_field "$CURRENT_DEPLOYMENT" accepted_writes 2>/dev/null || echo unknown)"

if [[ "$CURRENT_DEPLOYMENT" == "$TARGET_DEPLOYMENT" ]]; then
  die "目标部署就是当前部署。" 2
fi

# 恢复旧镜像本身（不回数据库）只对“从未接受写入”的部署是安全的。
if [[ "$ACCEPTED" == "true" && $FORCE_DATA_DECISION -ne 1 ]]; then
  CURRENT_SNAP="$(ls -1t "$FTC_BACKUP_DIR"/ftc-snapshot-*.tar.gz 2>/dev/null | head -1 || true)"
  bash "$LIB_DIR/../backup.sh" >/dev/null 2>&1 || warn "无法生成回退前快照，继续前请人工备份。"
  cat >&2 <<EOF
[ftc:error] 当前部署（$CURRENT_DEPLOYMENT）已经对外开放并接受过写入。
直接回滚数据库会丢失其后的全部新资料，本工具拒绝静默执行。
已先保存当前状态快照：${CURRENT_SNAP:-（生成失败，请人工处理）}
请二选一后重跑：
  1) 保留新数据、只排障：ftc doctor / ftc logs --service app
  2) 明确接受丢失新写入：ftc rollback --to $TARGET_DEPLOYMENT --snapshot <升级前快照> --accept-data-loss
EOF
  exit 25
fi

TARGET_IMAGE="$(deployment_field "$TARGET_DEPLOYMENT" image)"
TARGET_VERSION="$(deployment_field "$TARGET_DEPLOYMENT" version)"

phase_set "rollback-stop"
compose_cmd stop app worker >/dev/null 2>&1 || true

if [[ -n "$SNAPSHOT" ]]; then
  phase_set "rollback-restore-snapshot"
  RESTORE_DIR="$FTC_ROOT/rollback-target-$TARGET_DEPLOYMENT"
  rm -rf "$RESTORE_DIR"
  "$LIB_DIR/../restore.sh" "$FTC_BACKUP_DIR/$SNAPSHOT" --to "$RESTORE_DIR" || {
    phase_set "rollback-failed"
    compose_cmd up -d >/dev/null 2>&1 || true
    die "快照恢复失败；已尝试恢复启动当前版本。原数据卷未被修改。" 26
  }
  note "快照已解到隔离目录 $RESTORE_DIR；请人工确认后将其映射为数据卷（不自动覆盖生产卷）。"
  note "确认后：docker volume rm 旧卷并重建，或修改 env 的 FTC_DATA_VOLUME 指向恢复卷。"
else
  note "未指定 --snapshot：只回退代码镜像，数据库保持现状。"
  note "仅当数据库 schema 未被新版本迁移时这是安全的；不确定时请指定 --snapshot。"
  if [[ $ASSUME_YES -ne 1 ]]; then
    read -r -p "确认只回退镜像（不回数据库）？输入 yes：" CONFIRM
    [[ "$CONFIRM" == "yes" ]] || { compose_cmd up -d >/dev/null 2>&1 || true; die "已取消。" 1; }
  fi
fi

phase_set "rollback-image"
cp "$FTC_ENV_FILE" "$FTC_ENV_FILE.rollback-bak"
sed -i.bak "s#^FTC_IMAGE=.*#FTC_IMAGE=$TARGET_IMAGE#" "$FTC_ENV_FILE" && rm -f "$FTC_ENV_FILE.bak"
compose_cmd up -d --wait >/dev/null || {
  cp "$FTC_ENV_FILE.rollback-bak" "$FTC_ENV_FILE"
  compose_cmd up -d >/dev/null 2>&1 || true
  phase_set "rollback-failed"
  die "旧镜像启动失败；已尝试恢复。请 ftc doctor。" 13
}
state_set current_deployment "$TARGET_DEPLOYMENT"
state_set current_version "$TARGET_VERSION"
rm -f "$FTC_ENV_FILE.rollback-bak"
phase_clear
note "已回退到部署 $TARGET_DEPLOYMENT（$TARGET_VERSION / $TARGET_IMAGE）。"
