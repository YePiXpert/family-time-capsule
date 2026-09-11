#!/usr/bin/env bash
# Shared primitives for isolated candidate verification and paired activation.

require_no_pending_rollback() {
  [[ ! -f "$FTC_STATE_DIR/pending_rollback" ]] || die "回滚仍在等待核对：先执行 ftc rollback --activate/--abort <计划 ID>。" 28
}

ensure_image() {
  if [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    # An explicitly supplied local content ID is already immutable; it has no
    # registry tag to pull. This also supports offline recovery from kept images.
    [[ "$(docker inspect --format '{{.Id}}' "$1" 2>/dev/null)" == "$1" ]]
  else
    docker pull "$1"
  fi
}

switch_deployment_config() {
  # Image and volume are one durable update; never expose a half-switched pair.
  "$(ftc_python)" - "$FTC_ENV_FILE" "$1" "$2" <<'PY'
import os, re, sys, tempfile
filename, image, volume = sys.argv[1:]
assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/@:-]+", image), "invalid_image_reference"
assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]+", volume), "invalid_volume_name"
updates = {"FTC_IMAGE": image, "FTC_DATA_VOLUME": volume}
lines = open(filename, encoding="utf-8").read().splitlines()
lines = [line for line in lines if line.partition("=")[0] not in updates]
lines.extend(key + "=" + value for key, value in updates.items())
fd, staging = tempfile.mkstemp(prefix=".deployment-", dir=os.path.dirname(filename))
try:
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.write("\n".join(lines) + "\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(staging, filename)
    fd = os.open(os.path.dirname(filename), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
finally:
    if os.path.exists(staging): os.unlink(staging)
PY
  local result=$?
  [[ $result -eq 0 ]] || return "$result"
  load_env
}

new_candidate_volume() {
  local volume="ftc-data-$(new_deployment_id)"
  # A failed candidate is evidence, never a reason to delete/reuse a data volume.
  docker volume inspect "$volume" >/dev/null 2>&1 && die "候选数据卷已存在，拒绝复用。" 24
  docker volume create --label "app.familytimecapsule.project=$FTC_PROJECT_NAME" "$volume" >/dev/null || return 1
  printf '%s' "$volume"
}

copy_candidate_data() {
  local source="$1" target="$2" image="$3"
  docker run --rm --user 0:0 --network none \
    -v "$source:/source:ro" -v "$target:/target" "$image" \
    sh -c 'cp -a /source/. /target/ && chown -R 1001:1001 /target'
}

verify_candidate() {
  local image="$1" data="$2" uid="${3:-1001:1001}"
  local name="ftc-check-$(new_deployment_id)" passed=0
  # No ports, proxy aliases, worker, outbound network, or inherited setup token.
  # The app's real /api/health opens/migrates this candidate database.
  if docker run --detach --name "$name" --network none --user "$uid" \
    --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
    --env-file "$FTC_ENV_FILE" -e DATA_DIR=/data -e AI_PROVIDER=disabled \
    -e ASR_BASE_URL= -e WEBDAV_URL= -e INITIAL_SETUP_TOKEN= \
    -e BETTER_AUTH_URL=http://127.0.0.1:3000 -v "$data:/data" \
    "$image" node server.js >/dev/null; then
    for ((attempt=0; attempt<60; attempt++)); do
      if docker exec "$name" node /app/ops/healthcheck.mjs >/dev/null 2>&1; then passed=1; break; fi
      [[ "$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null)" == true ]] || break
      sleep 2
    done
  fi
  # Removing only our isolated process is safe; retain its data even on failure.
  docker logs "$name" 2>&1 | _redact > "$FTC_LOG_DIR/$name.log" || true
  chmod 600 "$FTC_LOG_DIR/$name.log"
  docker rm -f "$name" >/dev/null 2>&1 || return 1
  [[ $passed -eq 1 ]]
}

activate_deployment() {
  local id="$1" version="$2" image="$3" volume="$4"
  switch_deployment_config "$image" "$volume" || return 1
  record_deployment "$id" "$version" "$image" || return 1
  state_set current_version "$version" || return 1
  # Conservatively record possible writes BEFORE either process starts.
  mark_accepted_writes || return 1
  # A changed top-level volume.name does not always change Compose's service
  # hash. Force recreation so app/worker cannot retain the previous mount.
  compose_cmd up -d --wait --wait-timeout 90 --force-recreate
}
