#!/usr/bin/env bash
# ftc setup-info —— 显示受保护的初始化令牌（仅本机交互使用；不出现在 status/logs）。
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

TOKEN_FILE="$FTC_CONFIG_DIR/initial-setup-token"
if [[ ! -f "$TOKEN_FILE" ]]; then
  die "没有保存的初始化令牌（可能已清除或从未安装）。" 2
fi
if ! compose_cmd exec -T app node -e '
  const { DatabaseSync } = require("node:sqlite");
  const fs = require("node:fs");
  const dir = process.env.DATA_DIR || "/data";
  const dbFile = fs.readdirSync(dir + "/db").find((f) => f.endsWith(".sqlite"));
  const db = new DatabaseSync(dir + "/db/" + dbFile, { readOnly: true });
  const n = db.prepare("select count(*) as n from user").get().n;
  console.log(n > 0 ? "initialized" : "fresh");
' 2>/dev/null | grep -q fresh; then
  note "实例已完成初始化：令牌已失效（这正常）。保留文件仅供审计。"
  exit 0
fi
printf '一次性初始化令牌（只在屏幕显示，不写日志）：\n  %s\n' "$(cat "$TOKEN_FILE")"
note "管理员建立后请运行 ftc 完成清理：将 env 中 INITIAL_SETUP_TOKEN 置空并删除 $TOKEN_FILE。"
