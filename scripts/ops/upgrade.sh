#!/usr/bin/env bash
# ftc upgrade —— 升级（M6/M0-V）：预检 → 拉取 → 停写快照 → 迁移 → 验证 → 开放。
# 四类失败的处置：
#   A 拉取/预检失败   旧版继续运行，无数据动作。
#   B 快照/候选失败   原卷未被迁移，在原卷上恢复旧服务。
#   C 开放时失败      新卷可能接受写入，保留新配置并停写，禁止原卷静默回退。
#   D 已开放接受写入  拒绝静默回滚（rollback 会要求显式数据决策）。
# 版本规则（M0-V）：目标版本必须能从发布注册表（lib/releases.json）解析——
# digest 固定引用必须配 --version；未注册版本拒绝；迁移路径按注册表
# sequence/纪元判断，不用 sort -V，也不从 digest 截取版本。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"
source "$LIB_DIR/deployment.sh"

CHECK_ONLY=0
TARGET_IMAGE=""
TARGET_VERSION_FLAG=""
ALLOW_NONSTABLE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --image) TARGET_IMAGE="$2"; shift 2 ;;
    --version) TARGET_VERSION_FLAG="$2"; shift 2 ;;
    --allow-nonstable-target) ALLOW_NONSTABLE=1; shift ;;
    --help|-h) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "未知参数：$1" 2 ;;
  esac
done

[[ $CHECK_ONLY -eq 1 ]] || ftc_lock upgrade
load_env || die "尚未安装。" 2
[[ $CHECK_ONLY -eq 1 ]] || require_no_pending_rollback
CURRENT_VERSION="$(state_get current_version || echo unknown)"
CURRENT_DEPLOYMENT="$(state_get current_deployment || echo unknown)"
TARGET_IMAGE="${TARGET_IMAGE:-$FTC_IMAGE}"

# ---------------------------------------------------- 目标版本解析（注册表）
if ! RESOLVED="$(resolve_release "$TARGET_IMAGE" "$TARGET_VERSION_FLAG")"; then
  die "无法从发布注册表解析目标版本（镜像 $TARGET_IMAGE）。
  $RESOLVED
  digest 固定引用请加 --version <注册表内版本>；未知版本需先登记 lib/releases.json。" 26
fi
TARGET_VERSION="$(printf '%s' "$RESOLVED" | "$(ftc_python)" -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
TARGET_CHANNEL="$(printf '%s' "$RESOLVED" | "$(ftc_python)" -c 'import json,sys; print(json.load(sys.stdin)["channel"])')"

# 迁移路径校验：当前版本未知（极老安装）时给出明确指引，而不是静默放行。
ALLOW_FLAG=""
[[ $ALLOW_NONSTABLE -eq 1 ]] && ALLOW_FLAG="1"
if [[ "$CURRENT_VERSION" != "unknown" ]]; then
  TRANSITION="$(assert_release_transition "$CURRENT_VERSION" "$TARGET_VERSION" "$TARGET_IMAGE" "$ALLOW_FLAG")"
else
  warn "当前安装没有记录版本（state/current_version 缺失）；无法核对迁移白名单。"
  warn "如该实例来自探索期，请先用 ftc status 确认数据卷归属，再带 --version 重试。"
  die "拒绝在版本未知的情况下升级。" 26
fi
FROM_CHANNEL="$(printf '%s' "$TRANSITION" | "$(ftc_python)" -c 'import json,sys; print(json.load(sys.stdin)["from"]["channel"])')"

if [[ $CHECK_ONLY -eq 1 ]]; then
  cat <<EOF
升级计划（只读，不执行）
  当前版本     $CURRENT_VERSION（$FROM_CHANNEL 通道，部署 $CURRENT_DEPLOYMENT）
  当前镜像     $FTC_IMAGE
  目标镜像     $TARGET_IMAGE
  目标版本     $TARGET_VERSION（$TARGET_CHANNEL 通道）
  迁移判定     按注册表 sequence/纪元白名单通过（不用 sort -V，不从 digest 截取）
  停机说明     升级需要维护窗口：停写 → 快照 → 迁移 → 验证，期间服务不可用（不承诺零停机）。
  数据策略     停写快照后复制到新卷，隔离迁移验证；成功才配对切换镜像与数据卷。
  回退策略     候选失败恢复未改动的原卷；开放失败停写保留新卷，快照回滚须核对后启用。
风险提示
  - 通道纪律：stable 只沿 stable 升级；去往 development/candidate 需 --allow-nonstable-target。
  - 探索期（0.1.x / 1.x alpha / rc.1~rc.4）可升级到正式 1.0 主线；反向不允许。
  - 磁盘不足会直接中止，不会删除旧备份腾空间。
EOF
  exit 0
fi

ensure_layout

# ---------------------------------------------------------- 预检（阶段 0）
phase_set "upgrade-preflight"
[[ "$TARGET_IMAGE" != "$FTC_IMAGE" ]] || note "目标镜像与当前一致，仅执行一致性升级。"
check_disk_free_mb "$FTC_BACKUP_DIR" 2048

# ---------------------------------------------------------- A：先取镜像（阶段 1）
phase_set "upgrade-pull"
if ! ensure_image "$TARGET_IMAGE" >/dev/null 2>&1; then
  phase_clear
  die "目标镜像拉取失败（A 类）：旧版继续运行，未做任何数据动作。" 11
fi

# Pin the verified candidate and the public app/worker to the exact pulled image.
PINNED_IMAGE="$(docker inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$TARGET_IMAGE")"
[[ -n "$PINNED_IMAGE" ]] || { phase_clear; die "无法确定目标镜像身份，原服务未变。" 11; }

resume_original() {
  phase_set "upgrade-recover-original"
  if compose_cmd up -d --wait --wait-timeout 90 >/dev/null 2>&1; then
    phase_clear
    note "原镜像已在未迁移的原数据卷上恢复服务。"
  else
    phase_set "upgrade-original-start-failed"
    warn "原卷未改动，但旧服务未恢复；请检查日志后 ftc start。"
  fi
}

# The parent owns the entire stop-write interval. Nested backup never restarts.
phase_set "upgrade-snapshot"
if ! LAST_SNAP="$(bash "$LIB_DIR/../backup.sh" --keep-stopped)"; then
  resume_original
  die "快照失败（B 类）：未启动新版本，未迁移原数据卷。" 23
fi
[[ -f "$LAST_SNAP" && -f "$LAST_SNAP.sha256" ]] || {
  resume_original
  die "备份未返回完整快照，取消升级。" 23
}
state_set upgrade_snapshot "$LAST_SNAP"
state_set upgrade_source_volume "$FTC_DATA_VOLUME"

# All migration/verification writes are confined to a new candidate volume.
phase_set "upgrade-copy-candidate"
if ! TARGET_VOLUME="$(new_candidate_volume)"; then
  resume_original
  die "无法创建候选卷；原卷未改动。" 23
fi
state_set upgrade_candidate_volume "$TARGET_VOLUME"
if ! copy_candidate_data "$FTC_DATA_VOLUME" "$TARGET_VOLUME" "$PINNED_IMAGE"; then
  resume_original
  die "候选复制失败（B 类）；保留候选卷 $TARGET_VOLUME 供检查。" 23
fi
phase_set "upgrade-verify-candidate"
if ! verify_candidate "$PINNED_IMAGE" "$TARGET_VOLUME"; then
  resume_original
  die "候选迁移或验证失败（B 类）：原卷未被新版本打开；候选卷 $TARGET_VOLUME 与快照均保留。" 14
fi

# From this point onward public startup can accept writes, even if --wait fails.
phase_set "upgrade-open"
NEW_DEPLOYMENT="$(new_deployment_id)"
if ! activate_deployment "$NEW_DEPLOYMENT" "$TARGET_VERSION" "$PINNED_IMAGE" "$TARGET_VOLUME"; then
  compose_cmd stop app worker >/dev/null 2>&1 || warn "停止服务失败，请立即检查容器。"
  phase_set "upgrade-open-failed"
  die "新部署开放时失败（C 类）：可能已接受写入。保留新镜像与新卷 $TARGET_VOLUME，不自动切回旧库。请 ftc doctor / ftc start；回滚须先准备并核对快照。" 13
fi
printf 'parent=%s\nsnapshot=%s\n' "$CURRENT_DEPLOYMENT" "$LAST_SNAP" >> "$FTC_DEPLOYMENTS_DIR/$NEW_DEPLOYMENT.env"
phase_clear
note "升级完成：$CURRENT_VERSION → $TARGET_VERSION（$TARGET_CHANNEL 通道，部署 $NEW_DEPLOYMENT）。"
note "新镜像与新卷已配对开放；原卷和升级前快照保留。"
