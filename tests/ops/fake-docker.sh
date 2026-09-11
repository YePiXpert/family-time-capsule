#!/usr/bin/env bash
# 测试用 docker 假体：记录调用并按配置返回；只服务 tests/ops/ops-suite.test.ts。
set -u
LOG="${FAKE_DOCKER_LOG:?FAKE_DOCKER_LOG not set}"
printf '%s\n' "$*" >> "$LOG"

volume_path() {
  local base="${FTC_FAKE_VOLUME_HOST:-${FAKE_DOCKER_LOG%.log}-volume}"
  if [[ "$1" == capsule-data ]]; then printf '%s' "$base"; else printf '%s-%s' "$base" "$1"; fi
}

to_posix() {
  local p="$1"
  # 反斜杠用 printf 八进制生成，避免转义被外部工具折叠。
  local bs
  bs="$(printf '\134')"
  local re="^[A-Za-z]:[${bs}/]"
  if [[ "$p" =~ $re ]]; then
    local drive="${p:0:1}"
    local rest="${p:2}"
    printf '/%s%s' "$(echo "$drive" | tr 'A-Z' 'a-z')" "$(printf '%s' "$rest" | tr "$bs" '/')"
  else
    printf '%s' "$p"
  fi
}

case "${1:-}" in
  info)
    [[ -f "${FAKE_DOCKER_FAIL_INFO:-}" ]] && exit 1
    exit 0 ;;
  pull)
    [[ -f "${FAKE_DOCKER_FAIL_PULL:-}" ]] && exit 1
    exit 0 ;;
  volume)
    case "${2:-}" in
      ls)
        [[ -f "${FAKE_DOCKER_CONFLICT_VOLUME:-}" ]] && echo capsule-data
        exit 0 ;;
      inspect) [[ -d "$(volume_path "$3")" ]]; exit $? ;;
      create) mkdir -p "$(volume_path "${@: -1}")"; exit $? ;;
      *) exit 0 ;;
    esac ;;
  inspect)
    if [[ "${2:-}" == "--format" ]]; then
      if [[ "$3" == *State.Running* ]]; then
        [[ -f "${FAKE_DOCKER_FAIL_CANDIDATE:-}" ]] && echo false || echo true
      else
        echo "ghcr.io/yepixpert/family-time-capsule@sha256:abababababababababababababababababababababababababababababababab"
      fi
    fi
    exit 0 ;;
  exec)
    [[ -f "${FAKE_DOCKER_FAIL_CANDIDATE:-}" ]] && exit 1
    exit 0 ;;
  run)
    [[ -f "${FAKE_DOCKER_FAIL_PACK:-}" ]] && exit 1
    shift
    # 命名卷映射到本机目录（默认自动创建，可用 FTC_FAKE_VOLUME_HOST 指定）。
    volume_host="${FTC_FAKE_VOLUME_HOST:-${FAKE_DOCKER_LOG%.log}-volume}"
    mkdir -p "$volume_host"
    declare -A mounts=()
    image=""
    cmd=""
    detached=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --rm|--read-only) shift ;;
        --detach) detached=1; shift ;;
        --user|--network|--name|--tmpfs|--cap-drop|--security-opt|--env-file|-e) shift 2 ;;
        -v)
          spec="$2"
          if [[ "$spec" =~ ^[A-Za-z]: ]]; then
            # Windows 盘符（C:\...）：先摘出盘符，再找分隔冒号。
            drive="${spec:0:2}"
            remainder="${spec:2}"
            host_path="${drive}${remainder%%:*}"
            rest="${remainder#*:}"
          else
            host_path="${spec%%:*}"; rest="${spec#*:}"
          fi
          container_path="${rest%%:*}"
          if [[ "$host_path" != /* && ! "$host_path" =~ ^[A-Za-z]: ]]; then
            host_path="$(volume_path "$host_path")"
          fi
          mounts["$container_path"]="$(to_posix "$host_path")"; shift 2 ;;
        *) image="$1"; cmd="${@:2}"; break ;;
      esac
    done
    if [[ $detached -eq 1 && -f "${FAKE_DOCKER_CANDIDATE_SQL:-}" ]]; then
      python3 - "${mounts[/data]}/db/capsule.sqlite" "$FAKE_DOCKER_CANDIDATE_SQL" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.executescript(open(sys.argv[2]).read())
PY
    fi
    # 把 sh -c 命令中的容器路径改写为宿主映射后本地执行（备份打包等）。
    if [[ "$cmd" == sh\ -c* ]]; then
      inner="${cmd#sh -c }"
      # 按空白分词后做整词/前缀替换，避免 /stage/data.tar 被 /data 误替换。
      local_result=""
      for word in $inner; do
        replaced="$word"
        # Ownership is a container concern; the host fixture may run unprivileged.
        [[ "$word" == chown ]] && replaced=true
        for container_path in "${!mounts[@]}"; do
          if [[ "$word" == "$container_path" ]]; then
            replaced="${mounts[$container_path]}"
            break
          fi
          if [[ "$word" == "$container_path"/* ]]; then
            replaced="${mounts[$container_path]}${word#"$container_path"}"
            break
          fi
        done
        local_result+="$replaced "
      done
      bash -c "$local_result"
      exit $?
    fi
    exit 0 ;;
  compose)
    shift
    if [[ "${1:-}" == version ]]; then echo "Docker Compose version v2.0.0-fake"; exit 0; fi
    subcmd=""
    args=("$@")
    i=0
    while [[ $i -lt ${#args[@]} ]]; do
      case "${args[$i]}" in
        -p|-f|--env-file) i=$((i + 2)) ;;
        -*) i=$((i + 1)) ;;
        *) subcmd="${args[$i]}"; break ;;
      esac
    done
    case "$subcmd" in
      config)
        cat "${FAKE_COMPOSE_JSON:?FAKE_COMPOSE_JSON not set}"
        exit 0 ;;
      exec)
        [[ -f "${FAKE_DOCKER_FAIL_HEALTHCHECK:-}" ]] && exit 1
        # setup-info/doctor 的 node -e 探针：返回可配置结果。
        if [[ "$*" == *"from user"* ]]; then
          cat "${FAKE_DOCKER_USER_COUNT:-/dev/null}" 2>/dev/null || true
        fi
        exit 0 ;;
      up)
        if [[ -n "${FAKE_DOCKER_STATE_LOG:-}" ]]; then
          python3 - "$FTC_ROOT" "$FAKE_DOCKER_STATE_LOG" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
env = dict(line.split('=', 1) for line in (root/'config/env').read_text().splitlines() if '=' in line and not line.startswith('#'))
with open(sys.argv[2], 'a') as log:
    phase = (root/'state/phase').read_text() if (root/'state/phase').exists() else ''
    current = (root/'state/current_deployment').read_text() if (root/'state/current_deployment').exists() else ''
    record = root/'state/deployments'/f'{current}.env'
    deployment = dict(line.split('=', 1) for line in record.read_text().splitlines() if '=' in line) if record.exists() else {}
    log.write(json.dumps({'image': env.get('FTC_IMAGE'), 'volume': env.get('FTC_DATA_VOLUME'), 'phase': phase, 'accepted': deployment.get('accepted_writes')}) + '\n')
PY
        fi
        [[ -f "${FAKE_DOCKER_FAIL_UP:-}" ]] && exit 1
        if [[ -f "${FAKE_DOCKER_FAIL_PUBLIC_UP:-}" && -f "$FTC_ROOT/state/phase" ]]; then
          [[ "$(cat "$FTC_ROOT/state/phase")" == *-open ]] && exit 1
        fi
        exit 0 ;;
      *) exit 0 ;;
    esac ;;
  *)
    exit 0 ;;
esac
