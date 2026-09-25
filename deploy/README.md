# 家庭服务部署

服务负责设备授权、密文同步、AI 代理与额度，一台服务对应一个家庭。当前生产源码和验证结果只记录在 [HANDOFF](../HANDOFF.md)，本页是操作指南。

## 配置

参考 [.env.example](.env.example)，真实值只写私有配置。密钥文件权限 0600、运行用户 UID 1000 可读；不打印密钥、私有地址或完整容器环境。

| 变量 | 用途 |
| --- | --- |
| `SOURCE_SHA` | 完整 main 提交 SHA；镜像标签、revision 标签与健康版本一致 |
| `AI_DATA_DIR` | 数据目录；生产与 staging 必须独立 |
| `APP_PORT` | 宿主端口；staging 使用验证脚本规定的隔离端口 |
| `APP_BIND` | 除 127.0.0.1 之外的第二个监听地址（反代所在的私有网段）；必填，真实值只写私有 env |
| `AI_MODEL` | 固定 `gpt-6-astra`，五种文字任务均为 medium |
| `TRANSCRIBE_MODEL` | `mimo-v2.5-asr` |
| `UPSTREAM_BASE_URL` | 两种模型共用的 HTTPS 兼容上游 |
| `UPSTREAM_KEY_PATH` | 宿主密钥文件，Compose 只读挂载 |
| `UPSTREAM_KEY_FILE` | 服务读取的密钥文件路径；Compose 已固定为挂载点，只有直接运行 Node 脚本时才需要自己设 |

另有几个带默认值的变量，Compose 部署不用设：`DB_FILE`（`/data/ai.sqlite`）、`BACKUP_DIR`（`/data/backup`）、`PORT`（容器内 3000）、`FFMPEG_PATH`（镜像里的 ffmpeg）。

没有旧供应商变量、模型别名或自动回退。配置缺失或模型错误在打开数据库前失败；不跟随重定向、不自动重试。密钥每次调用重读。

文字使用 Chat Completions、JSON 结果，预算 16384 completion tokens；只接受完整有效结果，不返回推理过程。语音先用 ffmpeg 转为 16 kHz 单声道 wav，再以 `input_audio` 请求；最长三分钟、上传最多 5 MiB，音频不进数据库或日志。

## 更新步骤

1. 通过双端本地门禁，提交并推送 main；记录完整 SHA。
2. 从该提交的干净快照构建镜像 `anan-ai:$SOURCE_SHA`，设置 `org.opencontainers.image.revision=$SOURCE_SHA`，避免带入工作区修改：

```sh
BUILD_DIR=$(mktemp -d -p /var/tmp)
git archive "$SOURCE_SHA" server deploy | tar -x -C "$BUILD_DIR"
docker build --label "org.opencontainers.image.revision=$SOURCE_SHA" -t "anan-ai:$SOURCE_SHA" "$BUILD_DIR/server"
TARGET_COMPOSE="$BUILD_DIR/deploy/compose.yaml"
```

3. 使用独立目录、端口和 Compose 项目启动 staging。验证通过后停止并移除 staging。
4. 保存旧镜像、私有环境与 Compose；停止生产写入后快照整个数据目录，包括 SQLite、WAL 和密文对象。
5. 使用目标源码的 Compose 和私有环境启动已构建镜像：

```sh
docker compose --env-file "$SERVICE_ENV" -p anan-ai -f "$TARGET_COMPOSE" up -d --no-build --pull never
```

6. 核对镜像 revision、容器 `SOURCE_SHA`、本机及公网 `/healthz` 版本；检查匿名接口仍拒绝，家庭、成员、设备、清单、额度与原值一致。健康地址取私有配置，不在手机 API 前缀后拼接。
7. 失败则停止新容器，将切换前的数据、配置和镜像一起恢复；成功后记录证据并更新 HANDOFF。回滚材料留在私有部署目录。

日常 `backup.sh` 只做 SQLite 在线备份、保留七份，不含密文对象；完整迁移／回滚必须另存对象库。手机仍应定期导出完整备份。它由宿主的 systemd 定时器每天运行一次（`ExecStart` 指向本仓库里的 `deploy/backup.sh`）；容器名、数据目录和备份目录的默认值对应生产，可用 `ANAN_CONTAINER`、`AI_DATA_DIR`、`BACKUP_DAILY_DIR` 覆盖。

从不带 `APP_BIND` 的旧 Compose 升级时，先在私有 env 里补上这台机器原来的第二个监听地址，否则 Compose 会直接报错、不会启动。

## 验证

Mock 门禁见 [开发指南](../docs/DEVELOPMENT.md)。生产只做健康、鉴权和数据核对，**不运行会创建家庭或修改备份的验收脚本**。

`verify-service.py` 只接受本机隔离 staging，先核对容器与数据挂载。只验证家庭、配对、恢复、备份、撤销时：

```sh
python3 server/scripts/verify-service.py --allow-live --skip-text --skip-transcribe --container "$STAGING_CONTAINER"
```

这条命令会写合成测试数据，但不调用模型。移除 skip 选项会产生至多五次文字与一次转写调用，须在已授权范围内执行。`probe-text.ts --allow-live` 也会产生五次文字调用。均使用合成资料、不输出正文；不要在命令行传密钥。

反代的请求体上限用 `server/scripts/probe-upload-limit.py --base <API 前缀>` 探：不带账号时只看反代是否放行 4／9 MB（期望都是服务自己的 JSON 401）；加 `--authenticated --container <容器>` 会在容器里临时登记一台探测设备真上传，结束时撤销它，不删任何清单。地址取私有配置。

有代理变量时，仅对本机验证移除大小写的 http_proxy／https_proxy／all_proxy，并设置 NO_PROXY；git 和 gh 保留所需代理。开发机临时空间不足时使用 `/var/tmp`。

## 日常管理

以下命令在容器内执行 `node src/manage.ts ...`：

| 命令参数 | 用途 |
| --- | --- |
| `activation` | 空服务生成一次性激活码；24 小时有效，只交给第一位管理者 |
| `ai status` | 查看 AI 暂停状态、限额与用量，不输出令牌 |
| `ai pause` / `ai resume` | 暂停／恢复，全家额度保留 |
| `ai limit global <次数>` | 全家每日文案上限 |
| `ai limit <家人称呼> <次数>` | 一位家人的每日文案上限 |
| `promote <家人称呼>` | 管理者设备与恢复码都丢失时，将仍有手机的家人升为管理者 |

手机负责正常的配对、停用和恢复。配对申请十分钟过期，批准后一天未确认自动作废；一年未使用的设备需重新批准。停用会作废未领取的批准，但保留已发布备份供换机找回。

## 数据与限制

- SQLite 只存家庭与设备元数据、令牌哈希、恢复包密文、配对、请求状态和用量；同步正文与附件始终是密文。AI 请求的文字／声音临时交给上游处理。
- 默认每日每人 20 次、全家 100 次文字任务，UTC 零点重置；失败不占成功额度，但计入调用总量限制。现有额度与暂停设置部署时保留。
- 同一请求 ID 不重复调用上游；文字成功结果在内存保留十分钟。重启或过期后明确告知，用户决定是否重试。
- 默认家庭备份上限 20 GiB，单对象 8 MiB；磁盘低于 5 GiB 拒绝上传，每设备最多两个并发上传。完成上传时重新校验授权与共享余量。
- 家庭对象共享去重、先到的对象不被覆盖；清单按设备保存。清单、48 小时上传占位和一小时宽限共同保护对象，存在引用未知的清单时不回收。
- 清空远端是单独的破坏性操作，不作为部署或探针收尾。命令行 `wipe-backup family` 会清空全家远端，必须明确要求后才执行。
