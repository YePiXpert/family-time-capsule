#!/usr/bin/env bash
# ftc doctor —— 深度诊断（M5/M6）：配置、端口审计、HTTPS、worker 心跳、数据权限。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

ISSUES=0
fail() { warn "✗ $1"; ISSUES=$((ISSUES + 1)); }
ok() { note "✓ $1"; }

[[ -f "$FTC_ENV_FILE" ]] || die "尚未安装。请先 ftc install。" 2
load_env || true

[[ -f "$FTC_ENV_FILE" ]] && [[ "$(stat -c '%a' "$FTC_ENV_FILE" 2>/dev/null || echo 600)" -le 600 ]] \
  && ok "env 权限 ≤0600" || fail "env 权限过宽：$FTC_ENV_FILE"

compose_cmd config --quiet >/dev/null 2>&1 && ok "compose 配置可解析" || fail "compose 配置解析失败"
audit_compose_ports && ok "端口审计：app 未公开暴露" || true

if compose_cmd ps --status running 2>/dev/null | grep -q app; then ok "app 容器运行中"; else fail "app 容器未运行"; fi
if compose_cmd exec -T app node /app/ops/healthcheck.mjs >/dev/null 2>&1; then
  ok "app /api/health 正常"
else
  fail "app 健康检查失败"
fi

# worker：进程存在 ≠ 工作正常；有界只读探针读取数据库与队列状态。
WORKER_PROBE='
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const dir = process.env.DATA_DIR || "/data";
const dbFile = fs.readdirSync(dir + "/db").find((f) => f.endsWith(".sqlite"));
const db = new DatabaseSync(dir + "/db/" + dbFile, { readOnly: true });
const tables = db.prepare("select name from sqlite_master where type=\"table\"").all().map((r) => r.name);
let pendingJobs = null;
if (tables.includes("ai_job")) {
  pendingJobs = db.prepare("select count(*) as n from ai_job where status in (\"queued\",\"running\")").get().n;
}
console.log(JSON.stringify({ ok: true, pendingJobs }));
'
if compose_cmd exec -T worker node -e "$WORKER_PROBE" >/dev/null 2>&1; then
  ok "worker 只读探针通过（进程在且能打开数据库）"
else
  warn "worker 队列探针不可用（可能是版本差异），回退到进程状态判断。"
  compose_cmd ps --status running 2>/dev/null | grep -q worker && ok "worker 进程运行中" || fail "worker 未运行"
fi

# app 与 worker 必须同镜像同摘要。
APP_IMAGE="$(compose_cmd images -q app 2>/dev/null | head -1 || true)"
WORKER_IMAGE="$(compose_cmd images -q worker 2>/dev/null | head -1 || true)"
if [[ -n "$APP_IMAGE" && -n "$WORKER_IMAGE" ]]; then
  [[ "$APP_IMAGE" == "$WORKER_IMAGE" ]] && ok "app/worker 同镜像" || fail "app 与 worker 镜像不一致"
fi

DOMAIN="$(printf '%s' "$BETTER_AUTH_URL" | sed -E 's#https?://##; s#/.*##')"
if [[ -n "$DOMAIN" ]] && command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 15 "https://$DOMAIN/api/bootstrap" >/dev/null 2>&1; then
    ok "外部 HTTPS /api/bootstrap 可达"
  else
    fail "外部 HTTPS 不可达（$DOMAIN）——DNS/防火墙/证书待查"
  fi
fi

PHASE="$(state_get phase || true)"
[[ -z "$PHASE" ]] && ok "无未完成操作阶段" || fail "存在未完成操作阶段：$PHASE（按 ftc upgrade --help 的恢复指引处理）"

if [[ $ISSUES -eq 0 ]]; then
  note "诊断通过，未发现问题。"
  exit 0
fi
die "发现 $ISSUES 个问题（见上）。" 1
