#!/bin/sh
# 每日 SQLite 在线备份：只含家庭与设备元数据、令牌哈希和用量，不含密文对象；保留最新七份。
# 默认值对应生产布局，可用环境变量覆盖。
set -eu
container=${ANAN_CONTAINER:-anan-ai-ai-1}
data_dir=${AI_DATA_DIR:-/opt/anan-ai/data}
daily_dir=${BACKUP_DAILY_DIR:-/opt/anan-ai/backups/daily}
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
# Back up the running release without parsing a newer, not-yet-deployed Compose configuration.
docker exec "$container" node src/manage.ts backup "/data/backup-$backup_stamp.sqlite"
mkdir -p "$daily_dir"
chmod 700 "$daily_dir"
mv "$data_dir/backup-$backup_stamp.sqlite" "$daily_dir/"
chmod 600 "$daily_dir/backup-$backup_stamp.sqlite"
DAILY_DIR="$daily_dir" python3 - <<'PY'
import os
from pathlib import Path
files=sorted(Path(os.environ['DAILY_DIR']).glob('backup-*.sqlite'),reverse=True)
for file in files[7:]: file.unlink()
PY
