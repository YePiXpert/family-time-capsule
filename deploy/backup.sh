#!/bin/sh
set -eu
cd /workspace/family-time-capsule
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
# Back up the running release without parsing a newer, not-yet-deployed Compose configuration.
docker exec anan-ai-ai-1 node src/manage.ts backup "/data/backup-$backup_stamp.sqlite"
mkdir -p /opt/anan-ai/backups/daily
chmod 700 /opt/anan-ai/backups/daily
mv "/opt/anan-ai/data/backup-$backup_stamp.sqlite" /opt/anan-ai/backups/daily/
chmod 600 "/opt/anan-ai/backups/daily/backup-$backup_stamp.sqlite"
python3 - <<'PY'
from pathlib import Path
files=sorted(Path('/opt/anan-ai/backups/daily').glob('backup-*.sqlite'),reverse=True)
for file in files[7:]: file.unlink()
PY
