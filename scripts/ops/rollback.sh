#!/usr/bin/env bash
# ftc rollback —— prepare an isolated restore, review access, then activate a paired image/volume.
# --to ID --snapshot FILE [--accept-data-loss] prepares; --activate PLAN --accept-data-loss --access-reviewed activates.
# --abort PLAN resumes the unchanged original deployment before activation.
set -euo pipefail
umask 077
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
source "$LIB_DIR/common.sh"
source "$LIB_DIR/deployment.sh"
TARGET_DEPLOYMENT="" SNAPSHOT="" ACTIVATE="" ABORT=""
ACCEPT_LOSS=0 ACCESS_REVIEWED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) TARGET_DEPLOYMENT="${2:?}"; shift 2 ;;
    --snapshot) SNAPSHOT="${2:?}"; shift 2 ;;
    --activate) ACTIVATE="${2:?}"; shift 2 ;;
    --abort) ABORT="${2:?}"; shift 2 ;;
    --accept-data-loss) ACCEPT_LOSS=1; shift ;;
    --access-reviewed) ACCESS_REVIEWED=1; shift ;;
    --yes) shift ;; # Legacy noninteractive flag is not an access/data-loss decision.
    --help|-h) sed -n '2,4p' "$0"; exit 0 ;;
    *) die "未知参数：$1" 2 ;;
  esac
done
ftc_lock rollback
ensure_layout
load_env || die "尚未安装。" 2
CURRENT_DEPLOYMENT="$(state_get current_deployment)"
plan_tool() { "$(ftc_python)" "$LIB_DIR/rollback_plan.py" "$@"; }
plan_field() { plan_tool field "$PLAN_FILE" "$1"; }

if [[ -n "$ACTIVATE" || -n "$ABORT" ]]; then
  [[ -z "$TARGET_DEPLOYMENT$SNAPSHOT" && ( -z "$ACTIVATE" || -z "$ABORT" ) ]] || die "准备、启用、取消只能选择一种。" 2
  PLAN_ID="${ACTIVATE:-$ABORT}"
  [[ "$PLAN_ID" =~ ^[A-Za-z0-9_-]+$ ]] || die "无效计划 ID。" 2
  [[ "$(state_get pending_rollback)" == "$PLAN_ID" ]] || die "该计划不是当前待处理回滚。" 28
  PLAN_FILE="$FTC_STATE_DIR/rollback-$PLAN_ID.json"
  plan_tool check "$PLAN_FILE" "$FTC_ENV_FILE" "$CURRENT_DEPLOYMENT" || die "部署已变化，拒绝切换；请核对回滚计划。" 28
  if [[ -n "$ABORT" ]]; then
    phase_set "rollback-abort"
    compose_cmd up -d --wait --wait-timeout 90 || die "原部署启动失败，计划仍保留。请检查日志。" 13
    rm -f "$FTC_STATE_DIR/pending_rollback"
    phase_clear
    note "已取消回滚并恢复原部署；隔离恢复资料仍保留。"
    exit 0
  fi
  [[ $ACCEPT_LOSS -eq 1 && $ACCESS_REVIEWED -eq 1 ]] || die "启用前须核对快照之后的停用、撤权、删除，并明确传入 --access-reviewed --accept-data-loss。当前仍停写。" 28
  compose_cmd stop app worker >/dev/null || die "无法停止写入，拒绝启用。" 23
  phase_set "rollback-verify-reviewed"
  plan_tool approve "$PLAN_FILE" || die "恢复目录复验失败；原卷未改动，计划保留。" 26
  RESTORE_DIR="$(plan_field restoreDirectory)"
  TARGET_IMAGE="$(plan_field targetImage)"
  TARGET_VERSION="$(plan_field targetVersion)"
  ensure_image "$TARGET_IMAGE" >/dev/null || die "旧镜像不可用，保持停写。" 11
  TARGET_VOLUME="$(new_candidate_volume)"
  state_set rollback_candidate_volume "$TARGET_VOLUME"
  copy_candidate_data "$RESTORE_DIR/data" "$TARGET_VOLUME" "$TARGET_IMAGE" || die "恢复卷复制失败；原卷与恢复目录保留。" 26
  verify_candidate "$TARGET_IMAGE" "$TARGET_VOLUME" || die "恢复卷启动验证失败；保持原配置，候选卷 $TARGET_VOLUME 保留。" 26
  phase_set "rollback-open"
  NEW_DEPLOYMENT="$(new_deployment_id)"
  if ! activate_deployment "$NEW_DEPLOYMENT" "$TARGET_VERSION" "$TARGET_IMAGE" "$TARGET_VOLUME"; then
    compose_cmd stop app worker >/dev/null 2>&1 || warn "停止服务失败，请立即检查容器。"
    rm -f "$FTC_STATE_DIR/pending_rollback"
    phase_set "rollback-open-failed"
    die "恢复部署开放时失败；当前配对配置与全部数据卷保留。可能已接受写入，不自动切回。请 ftc doctor / ftc start。" 13
  fi
  printf 'parent=%s\nrollback_plan=%s\n' "$CURRENT_DEPLOYMENT" "$PLAN_ID" >> "$FTC_DEPLOYMENTS_DIR/$NEW_DEPLOYMENT.env"
  rm -f "$FTC_STATE_DIR/pending_rollback"
  phase_clear
  note "回滚完成：$TARGET_VERSION，镜像与恢复卷 $TARGET_VOLUME 已配对启用；原卷保留。手机须重新登录。"
  exit 0
fi

[[ "$TARGET_DEPLOYMENT" =~ ^[A-Za-z0-9_-]+$ ]] || die "用法：ftc rollback --to <部署 ID> --snapshot <快照文件> [--accept-data-loss]" 2
require_no_pending_rollback
[[ "$CURRENT_DEPLOYMENT" != "$TARGET_DEPLOYMENT" ]] || die "目标部署就是当前部署。" 2
TARGET_IMAGE="$(deployment_field "$TARGET_DEPLOYMENT" image)"
TARGET_VERSION="$(deployment_field "$TARGET_DEPLOYMENT" version)"
ACCEPTED="$(deployment_field "$CURRENT_DEPLOYMENT" accepted_writes 2>/dev/null || true)"
# Unknown is conservatively treated as possibly accepting writes.
if [[ "$ACCEPTED" != false && $ACCEPT_LOSS -ne 1 ]]; then
  die "当前部署可能已接受写入，拒绝静默执行。保留新数据请 ftc doctor；确需准备旧快照时加 --accept-data-loss（准备阶段仍不切换生产）。" 25
fi
[[ -n "$SNAPSHOT" && "$SNAPSHOT" == "$(basename "$SNAPSHOT")" && "$SNAPSHOT" != .* ]] || die "必须指定备份目录中的 --snapshot 文件；禁止在未验证数据库兼容性时只回退镜像。" 2
[[ -f "$FTC_BACKUP_DIR/$SNAPSHOT" ]] || die "快照不存在。" 2
PLAN_ID="$(new_deployment_id)"
PLAN_FILE="$FTC_STATE_DIR/rollback-$PLAN_ID.json"
RESTORE_DIR="$FTC_ROOT/restores/$PLAN_ID"
mkdir -p "$FTC_ROOT/restores"
# Preserve the requested snapshot before current-state backup retention can run.
mkdir -p "$FTC_STATE_DIR/rollback-input-$PLAN_ID"
cp "$FTC_BACKUP_DIR/$SNAPSHOT" "$FTC_BACKUP_DIR/$SNAPSHOT.sha256" "$FTC_STATE_DIR/rollback-input-$PLAN_ID/"
phase_set "rollback-stop-and-snapshot"
if ! CURRENT_SNAPSHOT="$(bash "$LIB_DIR/../backup.sh" --keep-stopped)"; then
  compose_cmd up -d --wait --wait-timeout 90 >/dev/null 2>&1 || true
  die "回滚前快照失败；未执行恢复，已尝试恢复原服务。" 23
fi
phase_set "rollback-prepare"
if ! bash "$LIB_DIR/../restore.sh" "$FTC_STATE_DIR/rollback-input-$PLAN_ID/$SNAPSHOT" --to "$RESTORE_DIR" || \
   ! plan_tool prepare "$PLAN_FILE" "$FTC_ENV_FILE" "$CURRENT_DEPLOYMENT" "$FTC_DEPLOYMENTS_DIR/$TARGET_DEPLOYMENT.env" "$RESTORE_DIR" "$CURRENT_SNAPSHOT"; then
  compose_cmd up -d --wait --wait-timeout 90 >/dev/null 2>&1 || true
  phase_set "rollback-prepare-failed"
  die "隔离恢复或镜像/快照配对校验失败；原卷未修改，已尝试恢复原服务。" 26
fi
state_set pending_rollback "$PLAN_ID"
phase_set "rollback-awaiting-review"
cat >&2 <<EOF
[ftc:info] 回滚已准备，尚未启用；原服务保持停止，原卷没有被修改。
  恢复目录：$RESTORE_DIR
  当前状态快照：$CURRENT_SNAPSHOT
  核对快照之后的账号停用、读者撤权、删除记录；在隔离目录完成对账。
  隔离验证方式见 docs/BACKUP_RESTORE.md，不要直接使用 env.snapshot 开放公网。
  对账完成后：ftc rollback --activate $PLAN_ID --accept-data-loss --access-reviewed
  取消并恢复原服务：ftc rollback --abort $PLAN_ID
EOF
exit 28
