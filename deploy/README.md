# 桉桉成长记 AI 服务

生产入口 `https://capsule.yep.li/api/v1`。新服务复用旧版的 3140 端口，经原有 HTTPS 反向代理访问；模型通过现有 shared-services Docker 网络访问 CPA 的 cli-proxy-api:8317，不经过宿主机端口回流。首页提供应用说明，不承载照片数据库或旧版登录。

## 配置与启动

使用 `compose.yaml`，设置 `SOURCE_SHA`（完整 main 提交）、`AI_DATA_DIR`、`CPA_KEY_PATH`，临时验证可设置 `APP_PORT=3141`。CPA 密钥文件必须只允许服务器操作人员读取，并允许容器 UID 1000 读取；不加入仓库或日志。生产数据目录需属于 UID 1000。

```
docker compose --env-file /opt/anan-ai/service.env -p anan-ai -f deploy/compose.yaml up -d --build
```

AI 走账号制：空服务第一次在手机「我的 → AI 设置」创建主人账号（仅此一次）；家人账号由主人在管理页创建并分发（用户名＋初始密码），换手机直接登录，一个账号可挂多台设备。设备撤销、全局及成员额度在主人管理页调整。全部锁死时在服务器运行 `docker compose ... exec -T ai node src/manage.ts password <登录名或成员名> <新密码>` 兜底重置（先按登录名找，找不到再按成员名）。从旧版升级后已有成员照常使用，主人可在管理页给现有成员（标记「未设登录」）补设登录名与密码。

AI 固定 `deepseek-flash`，显式启用思考模式并设置 `reasoning_effort: high`。旧版保存的模型选择会归一为 Flash；已有额度、暂停状态和成员权限保留。

分组与文案提示词内置在 `server/src/prompts.ts`。分组只生成照片归属、短名称和客观画面摘要；文案生成朴素、温柔的标题与短正文，并禁止补造日期、对话和成长里程碑。

## 配额与数据

默认每人每天 100 张分析图片、20 次文案；全局 500 张、100 次。图片文案分析计入图片额度。每天 UTC 00:00 重置；上游调用最多并发 2，每人最多 200 次/日、全局 1000 次/日，避免只用摘要绕过额度。暂停与成员额度在发起上游之前检查。反向代理后所有客户端共享同一来源地址，登录、初始化与改密接口的按地址限流实际是全家共享的每分钟预算，属预期行为。

相同成员、同一请求 ID 不能再次调用上游；成功结果内存保留 10 分钟，重启或过期后返回明确状态，由用户选择是否重新生成。超时调用可能已经被上游计费，因此保留额度占用，不自动退款或换模型。

服务 SQLite 保存成员账号（用户名与密码哈希）、设备凭证哈希、请求状态和用量，不保存照片或生成正文。日志仅包含服务启动信息。无需 Redis、云相册或账号同步。

## 从 xiaomei-ai 改名到 anan-ai（只做一次）

数据目录、compose 项目名与镜像名都从 `xiaomei-ai` 改成了 `anan-ai`。手机端不受影响——
它只认 `https://capsule.yep.li/api/v1`，域名没变，设备凭证也不在服务端这一侧。

```sh
docker compose --env-file /opt/xiaomei-ai/service.env -p xiaomei-ai -f deploy/compose.yaml down
cp -a /opt/xiaomei-ai /opt/xiaomei-ai.bak          # 先留一份，确认无误再删
mv /opt/xiaomei-ai /opt/anan-ai
sed -i 's#/opt/xiaomei-ai#/opt/anan-ai#g' /opt/anan-ai/service.env
chown -R 1000:1000 /opt/anan-ai/data               # 容器 UID 不变
chmod 700 /opt/anan-ai/backups/daily
docker compose --env-file /opt/anan-ai/service.env -p anan-ai -f deploy/compose.yaml up -d --build
python3 server/scripts/verify-service.py --container anan-ai-ai-1
```

`verify-service.py` 过了再删 `/opt/xiaomei-ai.bak`。`crontab` 里的 `backup.sh` 路径已随仓库更新，
旧项目名的容器要手动 `docker rm`。成员、设备与额度都在 SQLite 里，随目录一起搬走，手机上无需重新加入。

## 备份与回滚

每日运行 `backup.sh`，使用 SQLite 在线备份，保留 7 份。数据库和 CPA 密钥必须分开、限制权限。健康检查每 30 秒执行 `/healthz`。

旧版切换前先停止 app/worker 的写入，备份 `/opt/ftc-trial` 的部署配置与旧数据卷，记录旧镜像 ID，再停用旧容器，保留备份至少 30 天。旧数据不自动迁入手机资料库。回滚时停止新版服务，使用保存的旧配置及镜像恢复 3140 端口；不要将 AI SQLite 挂到旧版数据卷。

## 验证

`server` 内运行 `npm ci && npm run typecheck && npm test`。`server/scripts/probe.ts` 使用仓库的几何图形测试照片，经 CPA 验证 DeepSeek Flash High 的看图和文案能力，不使用家庭照片。生产部署检查 HTTPS `/healthz` 的 SHA、未授权 401、账号登录与主人权限。发布来源由镜像标签和 healthz 中的 SOURCE_SHA 核对。
