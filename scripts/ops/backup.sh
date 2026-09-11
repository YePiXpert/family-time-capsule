#!/usr/bin/env bash
# ftc backup —— 一致性实例快照（M6）。
# 策略：维护门禁 + 停止 app/worker（停写）→ 打包数据库+原件+配置 → 校验。
# 快照含账号与敏感配置：单独保管，绝不当作家庭阅读包分享；未加密存储时不承诺端到端加密。
# 用法：backup.sh [--keep-stopped | verify <snapshot-file>]
set -euo pipefail
umask 077

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

if [[ "${1:-}" == "verify" ]]; then
  [[ $# -eq 2 ]] || die "用法：backup.sh verify <snapshot-file>" 2
  SNAP="${2:?用法：backup.sh verify <snapshot.tar.gz>}"
  [[ -f "$SNAP" ]] || die "快照不存在：$SNAP" 2
  [[ -f "$SNAP.sha256" ]] || die "缺少校验文件：$SNAP.sha256" 2
  "$(ftc_python)" "$LIB_DIR/snapshot.py" verify "$SNAP"
  note "快照校验通过：$(basename "$SNAP")"
  exit 0
fi
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,5p' "$0"
  exit 0
fi
KEEP_STOPPED=0
if [[ "${1:-}" == "--keep-stopped" ]]; then KEEP_STOPPED=1; shift; fi
[[ $# -eq 0 ]] || die "未知备份参数。用法：backup.sh [--keep-stopped | verify <snapshot-file>]" 2

ftc_lock backup
ensure_layout
load_env || die "尚未安装。" 2
[[ $KEEP_STOPPED -eq 1 || ! -f "$FTC_STATE_DIR/pending_rollback" ]] || die "回滚等待核对中；请使用 backup --keep-stopped，或先完成/取消回滚。" 28
[[ "$FTC_BACKUP_KEEP" =~ ^[1-9][0-9]{0,8}$ ]] || die "FTC_BACKUP_KEEP 必须是正整数，至少保留一份快照。" 2

# 磁盘余量门槛：至少 2GB；不做任何“删旧备份腾空间”。
check_disk_free_mb "$FTC_BACKUP_DIR" 2048

ID="$(new_deployment_id)"
SNAP="$FTC_BACKUP_DIR/ftc-snapshot-$ID.tar.gz"
ARCHIVE_TMP="$FTC_BACKUP_DIR/.ftc-snapshot-$ID.tar.gz.partial"
SHA_TMP="$FTC_BACKUP_DIR/.ftc-snapshot-$ID.sha256.partial"
STAGING="$FTC_BACKUP_DIR/.staging-$ID"
mkdir -p "$STAGING"

# 停写后任何失败都必须尝试恢复服务；成功路径仍等待健康检查完成。
RESTART_NEEDED=0
backup_exit() {
  local code=$?
  if [[ $RESTART_NEEDED -eq 1 && $KEEP_STOPPED -eq 0 ]]; then
    compose_cmd up -d --wait --wait-timeout 90 >/dev/null 2>&1 || warn "服务恢复失败，请运行 ftc start。"
  fi
  rm -rf "$STAGING"
  rm -f "$ARCHIVE_TMP" "$ARCHIVE_TMP.sha256" "$SHA_TMP"
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
    die "数据卷打包失败；独立备份会尝试恢复服务，嵌套备份由调用方处理。" 23
}

cp "$FTC_ENV_FILE" "$STAGING/env"
IMAGE_DIGEST="$(docker inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$FTC_IMAGE" 2>/dev/null || echo "$FTC_IMAGE")"
"$(ftc_python)" - "$STAGING/manifest.json" "$FTC_TOOL_VERSION" "$(state_get current_version)" "$IMAGE_DIGEST" <<'PY'
import datetime, json, sys
output, tool, app, image = sys.argv[1:]
with open(output, "w", encoding="utf-8") as file:
    json.dump({"kind": "ftc-instance-snapshot", "version": 1,
               "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "toolVersion": tool, "appVersion": app or "unknown", "image": image,
               "sensitive": True, "contains": ["database", "originals", "instance-config"]}, file, indent=2)
PY
tar -czf "$ARCHIVE_TMP" -C "$STAGING" manifest.json env data.tar
# 校验文件只记录 basename，避免跨平台路径形态差异导致 -c 找不到文件。
(cd "$FTC_BACKUP_DIR" && sha256sum "$(basename "$ARCHIVE_TMP")" > "$(basename "$ARCHIVE_TMP").sha256")
rm -rf "$STAGING"

phase_set "backup-verify"
bash "$0" verify "$ARCHIVE_TMP" >/dev/null

# Publish only the verified artifact. Failed attempts never look like retained
# snapshots, and cannot evict the last valid copy during retention cleanup.
[[ ! -e "$SNAP" && ! -e "$SNAP.sha256" ]] || die "快照名称已存在，拒绝覆盖。" 23
read -r SNAP_SHA _ < "$ARCHIVE_TMP.sha256"
printf '%s  %s\n' "$SNAP_SHA" "$(basename "$SNAP")" > "$SHA_TMP"
# Retention may remove an older copy next. Make the verified replacement and
# its directory entries durable first, including across sudden power loss.
"$(ftc_python)" - "$ARCHIVE_TMP" "$SHA_TMP" "$SNAP" <<'PY'
import os, sys
archive, checksum, target = sys.argv[1:]
for name in (archive, checksum):
    with open(name, "rb") as file:
        os.fsync(file.fileno())
os.rename(checksum, target + ".sha256")
os.rename(archive, target)
directory = os.open(os.path.dirname(target), os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY

if [[ $KEEP_STOPPED -eq 0 ]]; then
  phase_set "backup-restart"
  compose_cmd up -d --wait --wait-timeout 90 >/dev/null
  phase_clear
else
  phase_set "backup-held-stopped"
fi
RESTART_NEEDED=0

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
printf '%s\n' "$SNAP"
