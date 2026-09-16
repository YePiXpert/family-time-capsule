#!/bin/sh
set -eu
cd /workspace/family-time-capsule
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose --env-file /opt/xiaomei-ai/service.env -p xiaomei-ai -f deploy/compose.yaml exec -T ai node src/manage.ts backup "/data/backup-$backup_stamp.sqlite"
mkdir -p /opt/xiaomei-ai/backups/daily
chmod 700 /opt/xiaomei-ai/backups/daily
mv "/opt/xiaomei-ai/data/backup-$backup_stamp.sqlite" /opt/xiaomei-ai/backups/daily/
chmod 600 "/opt/xiaomei-ai/backups/daily/backup-$backup_stamp.sqlite"
python3 - <<'PY'
from pathlib import Path
files=sorted(Path('/opt/xiaomei-ai/backups/daily').glob('backup-*.sqlite'),reverse=True)
for file in files[7:]: file.unlink()
PY
