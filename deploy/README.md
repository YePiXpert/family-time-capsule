# 桉桉成长记 AI 服务

生产入口 `[服务地址已省略]`，宿主机 3140，经现有 HTTPS 反代。首页仅提供应用说明。

## 当前执行边界（2026-09-24）

主人明确要求使用 `mimo-v2.6-pro`，指定中国 Token Plan 地址并提供匹配密钥。文字统一为 Pro（1.0.3 起不看图），服务转写继续为 `mimo-v2.5-asr`。本次以主人的明确选择作为配置授权。

生产已部署 `e200eb5cc329dba1062e603a0269134c9340b909`（1.0.8 发版提交；主人 2026-09-24「发包吧，服务端也一起部署」；07:05 UTC 从 1.0.3 的 `8be3a46` 切换）。相对 `8be3a46` 的服务端改动只有 `14cbcbd`：`GET /api/v1/backup/manifests` 也列出请求者自己名下被撤销设备的清单；没有数据库结构改动，模型与配置不变（env 只改 `SOURCE_SHA`）。先在独立数据目录的 staging 跑 `verify-service.py`（跳过付费的文字与转写调用），账号、登录、成员隔离、幂等、家庭备份空间与撤销全过；切换后本机与公网健康版本核对通过，五类匿名请求 401，成员、设备、设置、备份清单逐行保留。原镜像、原配置和切换前数据备份留在服务器私有部署目录，记录见 HANDOFF 第一节。

## 配置与启动（授权后才执行）

配置示例见 [.env.example](.env.example)，完整离线验证与上线／回滚步骤见 [MiMo 适配记录](../docs/MIMO-ADAPTATION.md)。新 Compose 必须使用新配置，不能直接复用旧的 CPA 环境文件。

| 用途 | 提供商／固定模型 | 地址与 secret | 授权记录 |
| --- | --- | --- | --- |
| 润色、追问、小问题、寄语、目录 | `AI_PROVIDER=mimo` / `AI_MODEL=mimo-v2.6-pro` | `AI_BASE_URL` / `AI_KEY_PATH` → `/run/secrets/ai-key` | `AI_ACCESS` |
| 专用转写 | `TRANSCRIBE_PROVIDER=mimo` / `TRANSCRIBE_MODEL=mimo-v2.5-asr` | `TRANSCRIBE_BASE_URL` / `TRANSCRIBE_KEY_PATH` → `/run/secrets/transcribe-key` | `TRANSCRIBE_ACCESS` |

普通 API 必须配普通 Key 和 `[服务地址已省略]`，经主人明确批准计费后设置对应 `*_ACCESS=payg-approved`。主人明确选择 Token Plan 时设置 `token-plan-authorized`，并配套餐专用 Key 与对应的 `token-plan-cn`／`token-plan-sgp`／`token-plan-ams` 地址。该字段记录主人的使用选择。没有默认授权、自动充值、按量回退或跨供应商回退。

密钥只存服务端权限 0600、UID 1000 可读的文件，Compose 只读挂载；env 只放文件路径。直接运行 Node 脚本时使用 `AI_KEY_FILE`／`TRANSCRIBE_KEY_FILE` 的绝对路径。缺少授权、模型不匹配、普通／套餐 Key 与地址混用、错误厂商地址会在启动数据库前拒绝；每次调用仍重读并核对 Key 类型。ASR 不继承文字服务的地址或密钥。旧 `CPA_*` 配置不会静默用于 MiMo。

在两路密钥与地址匹配、主人已指定使用方式、隔离 staging 验证通过且已保存旧配置／镜像及数据备份后执行：

```sh
docker compose --env-file /opt/anan-ai/service.env -p anan-ai -f deploy/compose.yaml up -d --no-build --pull never
```

部署前须按目标提交另行构建并验证镜像；实际部署状态见适配记录顶部。数据目录、端口及 `SOURCE_SHA` 的配置方式不变。

家庭与设备（main 上，随 1.1.0 部署；生产现为 1.0.8 的用户名＋密码版）：一台服务就是一家人，没有用户名和密码。

- 开家庭（空服务，一次）：在服务器上运行 `docker compose ... exec -T ai node src/manage.ts activation`（或 `npm run activation`），打印一个 25 位的一次性激活码（24 小时内有效、用过即废，库里只存哈希）；把它交给第一位管理者，在手机「我的 → 家庭与设备 → 开始一个家庭」输入。激活码只能当面或经可信渠道给，别贴进聊天记录以外会留存的地方。
- 1.0.8 的库升级：启动时自动迁移（原主人 → 管理者，行数不变，旧令牌照常可用；用户名与密码列留着不再用）。主人手机装 1.1.0 后在「家庭与设备」里「升级为家庭管理者」，凭现有令牌建家庭，只能一次，不需要激活码。
- 加手机：新手机出示二维码，管理者当面扫码批准（新增一位家人，或给已有家人加一台）；服务端只转交封好的钥匙包，二维码里的一次性秘密不经服务器。批准后 24 小时内新手机没确认就自动作废；配对申请 10 分钟过期，同时最多挂 20 条。
- 一年没用过的设备自动失效（最后使用时间最多每小时记一次）。停用设备、停用家人、改称呼与角色在手机「家庭与设备」里；不能停用或降级最后一位启用的管理者，也不能停用最后一台管理者手机。
- 所有管理者手机都丢了：新手机「用恢复码找回」（12 个词只在管理者的纸上；服务端存恢复包密文与恢复证明的哈希，按地址严格限流）。
- 最后一招（管理者手机与恢复码都丢了，还有家人的手机）：`docker compose ... exec -T ai node src/manage.ts promote <家人称呼>` 把一位家人升为管理者，再让他在手机上重新生成恢复码。

内容模型固定 `mimo-v2.6-pro`，只处理文字，保留五个 writingMode。`question`／`ask`／`polish` 关闭思考，`recap`／`editor` 开启；此策略已通过合成样例真实调用验证，尚未做家庭实际内容的长期质量评估。策略集中在 `server/src/ai-model.ts`。只发送 `max_completion_tokens: 16384`（含思考与最终 JSON），不发送 `reasoning_effort`、`max_tokens` 或采样参数。接口仍为非流式 JSON；只有 `finish_reason=stop`、非空合法 JSON 且通过原业务校验才成功，只解析最终 `message.content`。旧版 DeepSeek／更早模型选择归一为 MiMo，额度、暂停状态和成员权限保留。

「说一段」转写使用 `mimo-v2.5-asr`，调用 `/chat/completions` 的 `input_audio`（wav）形状。镜像自带 ffmpeg，把手机的 m4a 转为 16 kHz 单声道 wav；最长 3 分钟、请求体最多 5 MiB。Compose 支持 `TRANSCRIBE_MODEL`（默认 `mimo-v2.5-asr`）、`TRANSCRIBE_BASE_URL`（独立必填）、`TRANSCRIBE_KEY_PATH`（独立必填），并将转写密钥挂载到容器的 `/run/secrets/transcribe-key`。服务端不留声音：音频只在内存 tmpfs 里停留到转码结束，不写日志、不缓存、不进数据库；只记一次写作额度。失败不计当日额度，转写结果不缓存，同一请求 ID 重放只返回处理中或结果已过期。

五条提示词内置在 `server/src/prompts.ts`：POLISH 润色、RECAP 年度寄语、ASK 追问、QUESTION 今天的小问题、EDITOR 年度册目录建议。提示词全文以 `docs/AI-PROMPTS.md` 为准。editor 的 context 是 JSON，上限 60000 字，服务端不留。

## 配额与数据

默认每人每天 20 次写作、全局 100 次，每个内容请求计一次写作。AI 不再看照片，图片额度字段保留（默认每人 100 张、全局 500 张）但不再消耗。每天 UTC 00:00 重置；上游调用最多并发 2，每人最多 200 次/日、全局 1000 次/日，限制请求总量。暂停与成员额度在发起上游之前检查。反向代理后所有客户端共享同一来源地址，激活、配对、领取与恢复接口的按地址限流实际是全家共享的预算，属预期行为。

相同成员、同一请求 ID 不能再次调用上游；文字请求的成功结果内存保留 10 分钟，重启或过期后返回明确状态，由用户选择是否重新生成。失败或超时不占成员当日额度；上游可能已计费，但不自动重试或换模型。

服务 SQLite 保存家庭（id、钥匙指纹、恢复包密文、恢复证明哈希与版本）、成员（称呼、角色、启停、额度）、设备（令牌哈希、公钥、批准者、最后使用时间）、配对申请（领取凭据哈希；钥匙包只留到新手机确认）、激活码哈希、请求状态和用量，不保存照片、生成正文、内容钥匙或恢复词。日志仅包含服务启动信息及缺失 ffmpeg 的固定诊断，不含音频或转写文字。无需 Redis、云相册或账号同步。

## 从 xiaomei-ai 改名到 anan-ai（只做一次）

数据目录、compose 项目名与镜像名都从 `xiaomei-ai` 改成了 `anan-ai`。手机端不受影响——
它只认 `[服务地址已省略]`，域名没变，设备凭证也不在服务端这一侧。

```sh
docker compose --env-file /opt/xiaomei-ai/service.env -p xiaomei-ai -f deploy/compose.yaml down
cp -a /opt/xiaomei-ai /opt/xiaomei-ai.bak          # 先留一份，确认无误再删
mv /opt/xiaomei-ai /opt/anan-ai
sed -i 's#/opt/xiaomei-ai#/opt/anan-ai#g' /opt/anan-ai/service.env
chown -R 1000:1000 /opt/anan-ai/data               # 容器 UID 不变
chmod 700 /opt/anan-ai/backups/daily
docker compose --env-file /opt/anan-ai/service.env -p anan-ai -f deploy/compose.yaml up -d --build
curl --noproxy '*' -fsS http://127.0.0.1:3140/healthz
```

健康版本核对通过后再删 `/opt/xiaomei-ai.bak`。`crontab` 里的 `backup.sh` 路径已随仓库更新，
旧项目名的容器要手动 `docker rm`。成员、设备与额度都在 SQLite 里，随目录一起搬走，手机上无需重新加入。

## 家庭远端空间（Build 72；Build 70 起为对象库）

- 一台服务就是一家人：对象在容器 `/data/backup/family/objects/<对象 id 前两位>/<对象 id>`（宿主机 `/opt/anan-ai/data/backup/family/`），全家共用；对象 id 由手机按内容与钥匙派生，几台手机传同一张照片只存一份。临时文件在 `/data/backup/tmp/`，与成品同一文件系统，收完并核对长度与密文哈希后才 `rename` 到位。服务端只见密文、对象 id 与字节数——没有明文、密钥、文件名或照片哈希；家庭钥匙只在获准的手机上，交给新手机时用 HPKE 封给那台手机的公钥（1.0.8 及以前是 12 词恢复码直接当钥匙）。
- 清单按设备存：`backup_manifests_v2(device_id, member_id, key_id, index_b64, updated_at, objects_json)`，`PUT /backup/manifest` 记在发请求的设备名下，`GET /backup/manifest` 先给这台设备自己的、没有就给成员名下最新的一份（Build 71 换机恢复照旧），`GET /backup/manifests` 列出全家各台设备的清单（一起写的手机据此合并），`DELETE /backup/manifests/:deviceId` 删自己设备的（管理者可删任何一台）。删清单后顺手 prune 一次没人指着的对象（一小时宽限）。
- 一次性迁移（部署 Build 72 服务端时自动）：启动时 `migrateMemberSpaces()` 把 `/data/backup/<成员 id>/objects/` 里的对象 rename 进家庭空间（同 id 已在就删源文件），搬空的成员目录整个删掉；SQLite 里旧表 `backup_manifests` 逐行迁成 `device_id = 'legacy:<成员 id>'` 后 DROP——成员任一台设备发布过自己的清单，这份旧的就自动作废。两步都幂等。**部署前先 `cp -a /opt/anan-ai/data /opt/anan-ai/data.bak-$(date +%Y%m%d-%H%M)`**，回退到 Build 71 服务端只能连同这份数据一起回退（旧版找的是成员目录与旧表）。
- 配额与水位：全家共用第一位管理者的 `members.backup_limit_bytes`（默认 20 GiB，在管理接口调那一行，即 `PATCH /admin/members/:id` 的 `backupLimitBytes`；其他成员的这一列不再起作用）；单对象硬上限 8 MiB；磁盘剩余低于 5 GiB 一律 507 `SERVER_FULL`；每台设备同时最多 2 个上传（429 `BUSY`）。同 id 重传按「比原来多出的字节」算配额（对象 id 是手机按内容派生的，服务端认不出同 id 换了内容）。备份路由不走按地址的限流。`GET /backup/status` 是全家的：`{keyId（最新清单的）, manifestUpdatedAt, objects, bytes, limitBytes, freeBytes, manifests}`。
- 清单与回收：`PUT /backup/manifest` 除密文索引外可带 `objects`（全部引用的对象 id）：省略该键存为未知（`NULL`），显式 `[]` 表示确无引用。只要任一设备清单登记未知（包括旧版迁移行、超过 50000 个对象而省略登记的手机），prune 与删除清单后的回收都整轮跳过，返回 `{removed: 0, bytes: 0}`；全部登记明确时，保护名单是各清单引用 ∪ 客户端 keep ∪ 未过期的上传占位。远端已有清单时空 keep 仍返回 400。`have` 和 PUT 为本设备的对象在 SQLite 记 48 小时占位（重复请求续期、重启不丢，完整登记发布成功后由清单接管本设备保护），过期占位随请求清理，清空家庭空间也清占位；另保留一小时文件宽限。启动时清空 `tmp/`。撤销设备只让它退出全家合并，它的清单与对象仍然留着（同一位家人的新手机获准后还能把旧机那份合回来）；确实要删那份备份，另外调用 `DELETE /api/v1/backup/manifests/:deviceId`。
- 对象库是副本不是源头，手机才是源头：`backup.sh` 只快照 SQLite（成员、设备、配额、清单索引），不复制也不轮转对象库；对象文件本身就是事实来源，SQLite 回滚后手机下一次同步会自动补齐缺的对象。
- 删除：成员自己 `DELETE /api/v1/backup`（Build 71 的「删除远端备份」，只作废自己名下的清单）；管理者按成员 `DELETE /api/v1/admin/members/:id/backup`，清空全家 `DELETE /api/v1/admin/backup`；全部锁死时在服务器 `docker compose ... exec -T ai node src/manage.ts wipe-backup family`（清空全家）或 `wipe-backup <家人称呼>`（只删清单）。
- 反代：上传是 ≤ 8 MiB 的 `application/octet-stream` PUT，nginx 一类反代默认 1 MB 会先于我们拦下并回 HTML 413。每次改反代或升级服务后用 `python3 server/scripts/probe-upload-limit.py --authenticated --mb 4 9 --container anan-ai-ai-1` 探一次：4 MB 应 201，9 MB 应是我们的 JSON 413（`TOO_LARGE`）。带 `--authenticated` 会在容器里给第一位管理者临时登记一台探测设备（令牌不打印）、上传探测对象；收尾只撤销探测设备，对象留给服务端回收，**绝不能调用会删清单的接口收尾**。不符就在反代加 `client_max_body_size 16m; proxy_request_buffering off; proxy_read_timeout 130s;` 后重探。不带 `--authenticated` 只探反代（匿名 PUT 应得到我们的 JSON 401）。2026-09-20 部署 Build 70 服务端后匿名探过 0.5／4／9／16 MB 全部到达服务，反代无需改动。
- 验证生产不要直接对 3140 跑 `verify-service.py`（它会开测试家庭、配对测试手机并调用模型）：按下面「验证」节起一个 3141 的 staging 容器跑完再 `down`。本机若设置了 `http_proxy`，对 127.0.0.1 的请求要 `env -u http_proxy -u https_proxy …` 绕过。

## 备份与回滚

每日运行 `backup.sh`，使用 SQLite 在线备份，保留 7 份。数据库和上游密钥必须分开、限制权限。健康检查每 30 秒执行 `/healthz`。

旧版切换前先停止 app/worker 的写入，备份 `/opt/ftc-trial` 的部署配置与旧数据卷，记录旧镜像 ID，再停用旧容器，保留备份至少 30 天。旧数据不自动迁入手机资料库。回滚时停止新版服务，使用保存的旧配置及镜像恢复 3140 端口；不要将 AI SQLite 挂到旧版数据卷。

## 验证

`server` 内运行 `npm run typecheck && npm test`；Mock 测试不消耗模型额度。另运行 mobile 的 test／typecheck／lint 及本机边界门禁。

真实探针默认拒绝执行。仅主人授权真实调用后，用合成样例在 staging 运行：`node server/scripts/probe-text.ts --allow-live`（5 个文字模式各 1 次）。先设置独立的 `AI_*` 环境与 secret 文件；不得把 Key 放命令行或打印出来。每次最多 16384 completion tokens，不自动重试，只输出模型、模式、思考开关、成功状态、耗时、用量／错误码，不打印生成内容或完整响应。

`python3 server/scripts/verify-service.py --allow-live --container anan-ai-staging-ai-1` 只接受本机 3141 的隔离 staging，先检查容器配置与独立数据挂载，再执行最多 5 次内容生成和 1 次转写（两秒合成音频）；回放／无效输入应不触发额外上游调用。脚本用 `manage.ts activation` 在 staging 容器里开家庭，验证激活、扫码配对（服务端状态机，钥匙包是合成的）、恢复码找回、管理者隔离、备份与撤销，最后一行是「Family activation, device pairing, recovery, admin isolation, model results, idempotency, family backup space and revocation verified.」；会写测试数据，禁止对生产运行。可用 `--skip-transcribe`／`--skip-text` 缩小探测范围；转写探测须在主人授权的调用范围内执行。

2026-09-22 已对 1.0.3 镜像完成隔离 staging 验证（五次内容生成、一次转写、重放与负例）并切换生产；统计见适配记录顶部与 HANDOFF 第一节。来源由健康版本、镜像 ID 和部署提交核对；手机双端验收仍需真机。
