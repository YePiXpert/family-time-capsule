# 部署检查清单（DEPLOYMENT_CHECKLIST）

> 面向自托管部署者的操作手册。按顺序执行；每一步都给出预期结果与失败处理。
> 生成环境：Docker Compose（`docker-compose.yml`，镜像内含 ffmpeg）。
> 真实设备验收见 [REAL_DEVICE_TEST.md](./REAL_DEVICE_TEST.md)；数据模型与架构见同目录其他文档。

## 0. 前置

- 一台长期在线的机器（家庭服务器 / NAS / VPS），已安装 Docker 与 Docker Compose；
- 一个用于存放家庭数据的目录或 named volume 计划（Compose 逻辑名为 `capsule-data`；实际卷名通常带项目名前缀）；
- 生成两个 secret：`AUTH_SECRET`（≥32 随机字符）与 `INITIAL_SETUP_TOKEN`（一次性初始化令牌）：

```bash
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -hex 16      # → INITIAL_SETUP_TOKEN
```

## 1. 构建与启动

```bash
git clone <你的仓库地址> family-time-capsule && cd family-time-capsule
AUTH_SECRET=<上一步的值> INITIAL_SETUP_TOKEN=<上一步的值> docker compose up -d --build
```

预期：`docker compose ps` 显示 `app` 为 `running (healthy)`（端口 3000）。

生产镜像只携带 Next standalone 运行文件及 `/app/ops/*.mjs` 运维产物；恢复、导出校验、
部署冒烟和健康检查不依赖仓库里的 TypeScript 源码、`tsx` 或完整开发依赖。

排障：

```bash
docker compose logs --tail=100 app    # 看启动日志
```

- `AUTH_SECRET` 缺失 → compose 会拒绝启动（设计如此）。
- better-sqlite3 构建失败 → 确认镜像为 `node:24-alpine` 且 Dockerfile 已装构建依赖（`python3 make g++`）。

### 反向代理日志必须隐藏邀请 token

账号邀请使用 `/invite/<高熵 token>`。应用会发送 `no-store/no-referrer`，但请求到达应用前，
Nginx、Caddy、Traefik、CDN 或 NAS 网关可能已经记录完整 URL。生产部署必须在日志落盘前
把整个 `/invite/*` 路径改写为固定占位符；不要只隐藏 query，也不要继续记录原始 request line。

Nginx 可采用以下等价配置（重点是 access log 使用 `$ftc_safe_uri`，**不使用 `$request`**）：

```nginx
map $uri $ftc_safe_uri {
  ~^/invite/  /invite/[redacted];
  default     $uri;
}
log_format ftc '$remote_addr - $request_method $ftc_safe_uri $server_protocol $status';
access_log /var/log/nginx/family-time-capsule.access.log ftc;
```

其他代理应配置相同的 path-redaction，并检查现有日志、APM/trace、WAF 与 CDN analytics 都不
保留邀请路径。链接仍会出现在受邀者的浏览器历史中，因此只通过可信私聊发送；使用后立即失效，
疑似泄露时在「设置 → 账号邀请」撤销并重建。

## 2. 首次初始化

浏览器访问 `http://<服务器>:3000/setup`：

1. 填入 `INITIAL_SETUP_TOKEN`、显示名称、邮箱、密码（≥10 位）→ 创建管理员；
2. `/setup` 随即永久失效（即使令牌仍在）——这是预期行为；
3. 登录后进入 `/onboarding`：创建家庭、孩子档案（出生日期 = 时间轴年龄基准）、绑定自己。

初始化完成后**建议从环境中移除 `INITIAL_SETUP_TOKEN`** 并 `docker compose up -d` 重建。

## 3. 冒烟验证（在服务器上）

```bash
# 基础检查（无需凭据）
docker compose exec app node /app/ops/smoke-deployment.mjs

# 可选的只读认证检查：从已登录浏览器复制现有 session cookie；不会登录、上传或导出
docker compose exec app \
  env 'SMOKE_SESSION_COOKIE=better-auth.session_token=<现有值>' BASE_URL=http://localhost:3000 \
  node /app/ops/smoke-deployment.mjs
```

预期输出全部 `✓`；`ffmpeg/ffprobe` 缺失只会降级提示（本镜像已内置）。冒烟只做读取与会自动清理的临时可写探针，可在真实实例重复执行，不会留下测试媒体、导出 ZIP 或新会话。

## 4. 手工验收（浏览器 / 真机）

至少完成：

1. 上传一张手机里的 **HEIC 照片** → 收件箱显示「原件已安全保存，当前浏览器可能无法直接预览」+ 可下载（原件不丢、不转换）；
2. 上传一段 **MOV 视频** → 同上 fallback / 或可播放；
3. 上传一段 **M4A 外部录音** → 可播放、进入收件箱；
4. 上传一张 **三天前的照片** → 收件箱显示拍摄时间（非今天）→ 确认 → 时间轴出现在三天前；
5. 多选 2 张照片 → 合并为一个事件；
6. 同一事件留下两条不同家人的讲述 → 各自独立显示；
7. 创建并封存一个胶囊 → 未到期不显示正文；
8. 设置页导出 ZIP → 解压可看 Markdown、可播放媒体；
   容器内执行 `node /app/ops/verify-export.mjs <zip>` → 全绿。

完整清单（按设备/格式）见 [REAL_DEVICE_TEST.md](./REAL_DEVICE_TEST.md)。

## 5. 数据持久性验证（重要）

```bash
docker compose ps                  # running
# …上传一些照片，确认时间轴有内容…
docker compose down                # 停止（不删除 volume）
docker compose up -d
# → 刷新页面：照片、事件、时间轴全部还在
docker compose down
docker compose up -d --build       # 重建镜像后启动
# → 数据仍在（数据在 Compose 的 /data named volume，与镜像无关）
```

若数据丢失 → 检查是否误用了 `docker compose down -v`（**该命令会删除 volume，永远不要用**）。

## 6. 备份（RH-009）

### `/data` 里有什么（缺一不可）

| 路径 | 内容 |
| --- | --- |
| `/data/db/capsule.sqlite`（+ `-wal`/`-shm`） | 全部结构化数据：家庭、人物、事件、讲述、事实、胶囊、素材元数据 |
| `/data/originals/**` | **全部原件**（照片/录音/视频原始字节） |
| `/data/derivatives/**` | 衍生物（可删，可重建） |
| `/data/exports/**` | 历史导出 ZIP |

**只复制 sqlite 不复制 originals = 丢掉所有照片**；反过来则丢掉全部标题、时间与讲述。
二者必须一起备份。

### 推荐备份方式 A：停容器 → 打包（最简单、绝对一致）

```bash
# 必须在 app 仍运行时解析挂到 /data 的实际卷名；不要写死 capsule-data，
# Compose 默认会把它命名为 <项目名>_capsule-data。
APP_CONTAINER="$(docker compose ps -q app)"
DATA_VOLUME="$(docker inspect "$APP_CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
test -n "$DATA_VOLUME" || { echo '未找到 app 的 /data named volume' >&2; exit 1; }
echo "备份实际卷: $DATA_VOLUME"

docker compose down
docker run --rm -v "$DATA_VOLUME":/data:ro -v "$(pwd)":/backup alpine \
  tar czf /backup/capsule-data-$(date +%F).tar.gz -C /data .
docker compose up -d
```

`docker compose down`（不带 `-v`）不会删除该实际卷。恢复时同样先在容器运行期间按上面的 `docker inspect` 解析并记录 `DATA_VOLUME`，再 `down`，只向确认过的空目标卷解压，最后 `up -d`；不要用字面量 `capsule-data`，否则可能新建一个空卷而把真实数据留在另一个卷中。

### 推荐备份方式 B：应用内导出 ZIP（可迁移、自带哈希校验）

设置页「导出完整备份（ZIP）」，或：

```bash
docker compose exec app node /app/ops/verify-export.mjs /data/exports/<最新>.zip   # 校验
```

导出 ZIP **可跨实例恢复**（见 §7），且自带 SHA-256 完整性验证。建议两种方式都做：
tar 用于整机快速恢复，ZIP 用于跨机器/长期冷备。

### 在线 SQLite 快照（不停容器时，仅作为补充）

`VACUUM INTO` 产出一致性快照（已验证包含 WAL 中未 checkpoint 的写入）：

```bash
docker compose exec app node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/db/capsule.sqlite');
db.exec(\"VACUUM INTO '/data/exports/db-snapshot.sqlite'\");
db.close();
console.log('snapshot ok');
"
```

注意：这只备份数据库，**不含 originals**——必须与文件目录备份配对，且配对时点应尽量接近。

### 3-2-1 建议

- **3** 份数据（本机 volume + 本机 tar/ZIP + 异地一份）；
- **2** 种介质（如 NAS + 移动硬盘）；
- **1** 份异地（云端网盘 / 亲戚家硬盘；ZIP 导出自带加密能力暂未提供，请自选加密盘）。
- 每月至少一次完整导出 + `verify:export` 全绿；大日子（孩子生日等）前后各一次。

## 7. 灾难恢复（整机丢失 / 换机器）

前提：手里有一份导出 ZIP。

```bash
# 新机器：clone + 启动
AUTH_SECRET=<新或原值> INITIAL_SETUP_TOKEN=<新一次性令牌> docker compose up -d --build
# 浏览器 /setup 创建管理员（认证不来自备份）
# 把备份 ZIP 拷进容器可达位置后恢复：
docker compose cp capsule-backup.zip app:/tmp/backup.zip
docker compose exec app node /app/ops/restore.mjs /tmp/backup.zip
# 管理员登录 → /onboarding 选择「你是谁」→ 时间轴/媒体/胶囊全部回来
```

恢复只允许目标实例无 Family；`restore` 内置哈希校验与 zip bomb 防护，失败不留半恢复状态。
细节见 [RESTORE.md](./RESTORE.md)。

## 8. 升级版本

```bash
git pull
docker compose up -d --build     # 数据库迁移在启动后首次连接时自动应用
docker compose exec app node /app/ops/smoke-deployment.mjs
```

升级前先做一次 §6 备份。

## 9. 常见问题

| 现象 | 处理 |
| --- | --- |
| 上传 HEIC 后页面只显示占位 | 正常：多数桌面浏览器不解码 HEIC；原件已安全保存，点击「下载 / 打开原件」查看，iPhone 上可直接显示 |
| MOV 无法播放（Chrome） | 正常：HEVC 编码的 MOV 仅 Safari 原生支持；原件已保存，可下载后本地播放 |
| `/setup` 显示初始化已完成 | 已有管理员；如忘记密码见下 |
| 忘记管理员密码 | 停容器 → 备份 `/data` → 删除 volume 重建实例 → 用备份 ZIP 走 §7 恢复（认证重建） |
| 时间全部差 8 小时 | 检查家庭时区（设置页）；EXIF 无时区的照片按家庭时区解释（DECISIONS D-009） |
