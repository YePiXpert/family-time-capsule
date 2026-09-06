#!/usr/bin/env bash
# ftc status —— 运行状态概览（M5）。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

[[ -f "$FTC_ENV_FILE" ]] || die "尚未安装（找不到 $FTC_ENV_FILE）。请先 ftc install。" 2
load_env || true

printf '工具版本      %s\n' "$FTC_TOOL_VERSION"
printf '部署版本      %s\n' "$(state_get current_version || echo 未知)"
DEPLOYMENT="$(state_get current_deployment || true)"
printf '当前部署      %s\n' "${DEPLOYMENT:-未知}"
if [[ -n "$DEPLOYMENT" ]]; then
  printf '镜像          %s\n' "$(deployment_field "$DEPLOYMENT" image)"
fi
printf '安装模式      %s\n' "$(state_get install_mode || echo 未知)"
PHASE="$(state_get phase || true)"
[[ -n "$PHASE" ]] && warn "存在未完成的操作阶段：$PHASE"

printf '\n[容器]\n'
compose_cmd ps 2>/dev/null | sed 's/^/  /' || warn "无法读取容器状态。"

printf '\n[镜像摘要]\n'
for service in app worker; do
  DIGEST="$(compose_cmd images -q "$service" 2>/dev/null | head -1 || true)"
  if [[ -n "$DIGEST" ]]; then
    RESOLVED="$(docker inspect --format '{{index .RepoDigests 0}}' "$DIGEST" 2>/dev/null || echo "$DIGEST")"
    printf '  %-7s %s\n' "$service" "$RESOLVED"
  fi
done

printf '\n[健康]\n'
if compose_cmd exec -T app node /app/ops/healthcheck.mjs >/dev/null 2>&1; then
  printf '  app    健康\n'
else
  printf '  app    异常\n'
fi
if command -v curl >/dev/null 2>&1; then
  LOOPBACK_PORT="$(grep -E '^FTC_LOOPBACK_PORT=' "$FTC_ENV_FILE" | cut -d= -f2 || true)"
  if [[ -n "$LOOPBACK_PORT" ]] && curl -fsS --max-time 8 "http://127.0.0.1:$LOOPBACK_PORT/api/health" >/dev/null 2>&1; then
    printf '  环回 API  可达\n'
  fi
fi

printf '\n[磁盘]\n'
df -h "$FTC_ROOT" 2>/dev/null | awk 'NR<=2{printf "  %s\n", $0}'

printf '\n[备份]\n'
LAST_BACKUP="$(ls -1t "$FTC_BACKUP_DIR"/*.tar.gz 2>/dev/null | head -1 || true)"
if [[ -n "$LAST_BACKUP" ]]; then
  printf '  最近快照  %s\n' "$(basename "$LAST_BACKUP")"
  printf '  校验状态  %s\n' "$([[ -f "${LAST_BACKUP}.sha256" ]] && echo '  有 SHA256 文件' || echo '缺少 SHA256')"
else
  printf '  尚无快照\n'
fi
