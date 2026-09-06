#!/usr/bin/env bash
# ftc backup —— 一致性实例快照（M6）。
# 策略：维护门禁 + 停止 app/worker（停写）→ 打包数据库+原件+配置 → 校验。
# 快照含账号与敏感配置：单独保管，绝不当作家庭阅读包分享；未加密存储时不承诺端到端加密。
# 用法：backup.sh [verify <snapshot-file>]
set -euo pipefail
umask 077

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

if [[ "${1:-}" == "verify" ]]; then
  SNAP="${2:?用法：backup.sh verify <snapshot.tar.gz>}"
  [[ -f "$SNAP" ]] || die "快照不存在：$SNAP" 2
  [[ -f "$SNAP.sha256" ]] || die "缺少校验文件：$SNAP.sha256" 2
  (cd "$(dirname "$SNAP")" && sha256sum -c "$(basename "$SNAP").sha256") >/dev/null \
    || die "SHA256 校验失败：$SNAP" 22
  tar -tzf "$SNAP" >/dev/null || die "tar 完整性校验失败。" 22
  tar -xzOf "$SNAP" manifest.json >/dev/null 2>&1 || die "缺少 manifest.json。" 22
  note "快照校验通过：$(basename "$SNAP")"
  exit 0
fi

ftc_lock backup
ensure_layout
load_env || die "尚未安装。" 2

# 磁盘余量门槛：至少 2GB；不做任何“删旧备份腾空间”。
check_disk_free_mb "$FTC_BACKUP_DIR" 2048

ID="$(new_deployment_id)"
SNAP="$FTC_BACKUP_DIR/ftc-snapshot-$ID.tar.gz"
STAGING="$FTC_BACKUP_DIR/.staging-$ID"
mkdir -p "$STAGING"

# 停写后任何失败都必须尝试恢复服务；成功路径仍等待健康检查完成。
RESTART_NEEDED=0
backup_exit() {
  local code=$?
  if [[ $RESTART_NEEDED -eq 1 ]]; then
    compose_cmd up -d --wait >/dev/null 2>&1 || warn "服务恢复失败，请运行 ftc start。"
  fi
  rm -rf "$STAGING"
  ftc_unlock backup
  exit "$code"
}
trap backup_exit EXIT

phase_set "backup-stop-write"
RESTART_NEEDED=1
compose_cmd stop app worker >/dev/null || die "无法停止写入，取消备份。" 23

phase_set "backup-pack"
# 用应用镜像自身打包（busybox tar），避免引入新镜像源。
docker run --rm --user 0:0 --network none \
  -v "$FTC_DATA_VOLUME:/data:ro" \
  -v "$STAGING:/stage" \
  "${FTC_IMAGE:?}" sh -c 'tar -cf /stage/data.tar -C /data .' || {
    die "数据卷打包失败；服务已尝试恢复启动。" 23
}

cp "$FTC_ENV_FILE" "$STAGING/env"
IMAGE_DIGEST="$(docker inspect --format '{{index .RepoDigests 0}}' "$FTC_IMAGE" 2>/dev/null || echo "$FTC_IMAGE")"
cat > "$STAGING/manifest.json" <<EOF
{
  "kind": "ftc-instance-snapshot",
  "version": 1,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "toolVersion": "$FTC_TOOL_VERSION",
  "appVersion": "$(state_get current_version || echo unknown)",
  "image": "$IMAGE_DIGEST",
  "sensitive": true,
  "contains": ["database", "originals", "instance-config"],
  "note": "实例快照包含账号与配置，受保护保管；与面向家庭迁移的 portable archive 是不同产物。"
}
EOF
tar -czf "$SNAP" -C "$STAGING" manifest.json env data.tar
# 校验文件只记录 basename，避免跨平台路径形态差异导致 -c 找不到文件。
(cd "$(dirname "$SNAP")" && sha256sum "$(basename "$SNAP")" > "$(basename "$SNAP").sha256")
rm -rf "$STAGING"

phase_set "backup-verify"
bash "$0" verify "$SNAP"

phase_set "backup-restart"
compose_cmd up -d --wait >/dev/null
RESTART_NEEDED=0
phase_clear

# 保留策略：仅清理本工具创建的旧快照，且绝不删除最后一个可用副本。
cd "$FTC_BACKUP_DIR"
COUNT="$(ls -1t ftc-snapshot-*.tar.gz 2>/dev/null | wc -l || echo 0)"
if [[ "$COUNT" -gt "$FTC_BACKUP_KEEP" ]]; then
  ls -1t ftc-snapshot-*.tar.gz | tail -n +$((FTC_BACKUP_KEEP + 1)) | while read -r old; do
    rm -f "$old" "$old.sha256"
    note "按保留策略清理旧快照：$(basename "$old")"
  done
fi
note "快照完成：$(basename "$SNAP")（保留最近 $FTC_BACKUP_KEEP 份）。"
