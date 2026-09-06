#!/usr/bin/env bash
# ftc upgrade —— 升级（M6）：预检 → 拉取 → 停写快照 → 迁移 → 验证 → 开放。
# 四类失败的处置：
#   A 拉取/预检失败   旧版继续运行，无数据动作。
#   B 迁移前失败      恢复旧服务状态，不动数据库。
#   C 迁移后未开放前  允许用已验证快照 + 旧镜像恢复（rollback --to）。
#   D 已开放接受写入  拒绝静默回滚（rollback 会要求显式数据决策）。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

CHECK_ONLY=0
TARGET_IMAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --image) TARGET_IMAGE="$2"; shift 2 ;;
    --help|-h) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "未知参数：$1" 2 ;;
  esac
done

load_env || die "尚未安装。" 2
CURRENT_VERSION="$(state_get current_version || echo unknown)"
CURRENT_DEPLOYMENT="$(state_get current_deployment || echo unknown)"
TARGET_IMAGE="${TARGET_IMAGE:-$FTC_IMAGE}"
TARGET_VERSION="$(printf '%s' "$TARGET_IMAGE" | sed -E 's/.*://')"

if [[ $CHECK_ONLY -eq 1 ]]; then
  cat <<EOF
升级计划（只读，不执行）
  当前版本     $CURRENT_VERSION（部署 $CURRENT_DEPLOYMENT）
  当前镜像     $FTC_IMAGE
  目标镜像     $TARGET_IMAGE
  目标版本     $TARGET_VERSION
  停机说明     升级需要维护窗口：停写 → 快照 → 迁移 → 验证，期间服务不可用（不承诺零停机）。
  回退策略     迁移完成且开放写入前可用已验证快照回退；开放后回退需显式数据决策。
风险提示
  - prerelease 通道保持 prerelease；stable 不会自动升级到 alpha。
  - 磁盘不足会直接中止，不会删除旧备份腾空间。
EOF
  exit 0
fi

ftc_lock upgrade
ensure_layout

# ---------------------------------------------------------- 预检（阶段 0）
phase_set "upgrade-preflight"
[[ "$TARGET_IMAGE" != "$FTC_IMAGE" ]] || note "目标镜像与当前一致，仅执行一致性升级。"
check_disk_free_mb "$FTC_BACKUP_DIR" 2048

# ---------------------------------------------------------- A：先取镜像（阶段 1）
phase_set "upgrade-pull"
if ! docker pull "$TARGET_IMAGE" >/dev/null 2>&1; then
  phase_clear
  die "目标镜像拉取失败（A 类）：旧版继续运行，未做任何数据动作。" 11
fi

# ---------------------------------------------------------- B：停写 + 快照（阶段 2）
phase_set "upgrade-snapshot"
note "进入维护窗口：停止写入并生成一致性快照。"
SNAP_ID="$(new_deployment_id)"
if ! "$LIB_DIR/../backup.sh" >/dev/null; then
  phase_set "upgrade-recover-old"
  compose_cmd up -d --wait >/dev/null 2>&1 || true
  phase_clear
  die "快照失败（B 类）：已尝试恢复旧服务；数据库未被修改。" 23
fi
LAST_SNAP="$(ls -1t "$FTC_BACKUP_DIR"/ftc-snapshot-*.tar.gz 2>/dev/null | head -1 || true)"
[[ -n "$LAST_SNAP" ]] || { compose_cmd up -d >/dev/null 2>&1 || true; phase_clear; die "找不到刚生成的快照（B 类）。" 23; }

# ---------------------------------------------------------- 迁移（阶段 3）
phase_set "upgrade-migrate"
ROLLBACK_DEPLOYMENT="$CURRENT_DEPLOYMENT"
cp "$FTC_ENV_FILE" "$FTC_ENV_FILE.upgrade-bak"
sed -i.bak "s#^FTC_IMAGE=.*#FTC_IMAGE=$TARGET_IMAGE#" "$FTC_ENV_FILE" && rm -f "$FTC_ENV_FILE.bak"
if ! compose_cmd up -d --wait >/dev/null 2>&1; then
  # B 类：迁移前失败 → 恢复旧镜像配置并启动
  phase_set "upgrade-recover-old"
  cp "$FTC_ENV_FILE.upgrade-bak" "$FTC_ENV_FILE"
  rm -f "$FTC_ENV_FILE.upgrade-bak"
  compose_cmd up -d --wait >/dev/null 2>&1 || true
  phase_clear
  die "新版本启动失败（B 类）：已恢复旧版本配置；数据库未被新版本写入。" 13
fi

# ---------------------------------------------------------- 验证（阶段 4）
phase_set "upgrade-verify"
VERIFY_OK=1
compose_cmd exec -T app node /app/ops/healthcheck.mjs >/dev/null 2>&1 || VERIFY_OK=0
APP_IMG_ID="$(compose_cmd images -q app 2>/dev/null | head -1 || true)"
WORKER_IMG_ID="$(compose_cmd images -q worker 2>/dev/null | head -1 || true)"
[[ -n "$APP_IMG_ID" && "$APP_IMG_ID" == "$WORKER_IMG_ID" ]] || VERIFY_OK=0
if [[ $VERIFY_OK -ne 1 ]]; then
  # C 类：新版本已可能动过数据库，但从未对外接受写入（尚未标记）。
  phase_set "upgrade-verify-failed"
  cat >&2 <<EOF
[ftc:error] 升级验证失败（C 类）。当前保持维护状态，未对外开放写入。
  可选恢复路径（二选一，均需人工确认）：
  1) ftc rollback --to $ROLLBACK_DEPLOYMENT --snapshot "$(basename "$LAST_SNAP")"
     —— 用已验证快照 + 旧镜像恢复（会丢弃迁移后的数据库状态）。
  2) 排查后重跑 ftc upgrade --image $TARGET_IMAGE（继续尝试新版本）。
快照：$LAST_SNAP
EOF
  exit 14
fi

# ---------------------------------------------------------- 开放（阶段 5）
NEW_DEPLOYMENT="$(new_deployment_id)"
record_deployment "$NEW_DEPLOYMENT" "$TARGET_VERSION" "$TARGET_IMAGE"
state_set current_version "$TARGET_VERSION"
rm -f "$FTC_ENV_FILE.upgrade-bak"
phase_set "upgrade-open"
sleep 3
mark_accepted_writes
phase_clear
note "升级完成：$CURRENT_VERSION → $TARGET_VERSION（部署 $NEW_DEPLOYMENT）。已开放写入。"
note "从现在起回退需要显式数据决策（ftc rollback 会说明可能丢失的写入）。"
