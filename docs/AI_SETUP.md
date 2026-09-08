# AI 配置与使用

AI 默认关闭。配置发生在家庭时间胶囊的 VPS，不继承开发 Agent、Codex、
ChatGPT 等开发工具的模型账号、登录或额度。保存、查看、播放和同步无需 AI。

## 在 VPS 配置

使用同一发行版的服务端、worker 和 ftc 工具包，以有权操作本项目 Docker
及安装目录的系统账号执行：

```sh
ftc ai configure
ftc ai status
ftc ai test --capability text
ftc ai test --capability vision
ftc ai test --capability transcription
ftc ai disable
```

非默认安装使用 `FTC_ROOT=/实际目录 ftc ai status` 等相同命令。
默认目录 `/opt/family-time-capsule`，配置在 `config/env`，有效模板在
`releases/current/compose.yml`。工具需要 Python 3、Docker Compose v2 和 flock。

configure 中文引导路由模式与 endpoint、接收服务名称、模型与有限协议选项。

**正式 1.0 默认双路由（M6）**：`dual` 模式下文字与图片走你的 CPA
（默认模型 `gpt-5.6-luna`，Base URL 可用官方兼容地址或第三方兼容端点），
语音转写走 MiMo（默认端点 `https://api.xiaomimimo.com/v1`，默认模型
`mimo-v2.5-asr`，语种 auto/zh/en）。两条路由的 Base URL、Key、模型与
部署身份相互独立：只改一条路由的配置不会让另一条的历史同意失效。
MiMo 采用小米官方 ASR 契约（`chat/completions` + `input_audio`，`api-key`
认证头），仅接受 mp3/wav；其它音频格式会在转写前经 ffmpeg 转成有界 WAV
（原件不动）。MiMo 响应不含逐句时间戳，转录层只提供全文，不虚构定位。

`single` 模式保留单一 OpenAI 兼容端点（含 `/audio/transcriptions` 转写），
供确实只有一套端点的部署使用。某项模型留空只关闭那项能力；
不自动更换供应商。
Key 只在真实终端隐藏输入，不支持 `--key`、普通管道或把 Key 写入命令历史。
公网 endpoint 必须 HTTPS，仅 loopback 允许 HTTP。不绕过证书，不跟随重定向。

配置原子写入权限 0600 的私密文件，同时更新实际生效的 app/worker 环境块，
包括已有旧模板。保留 AUTH_SECRET、数据卷与反向代理；只重建本项目 app/worker，
有短暂服务中断。容器健康与 worker 心跳通过才完成；未知自定义 YAML 会拒绝修改。

失败会恢复旧配置并尝试重建旧服务。若仍失败，保留权限 0600 的
`state/ai-recovery.json`，运行 `ftc ai recover` 恢复配置事务。恢复文件含私密
环境，须受限保管；这不是家庭资料恢复入口，不操作数据卷。AI 配置与其他 ftc
升级、备份等写操作互斥。

status 分别进入正在运行的 app 和 worker，核对实际环境与 Compose 有效配置。
显示非秘密 endpoint、服务名称、模型、边界参数、“密钥已配置”、worker 心跳和
检测状态，不输出 Key 或 Key 摘要。状态查询不会请求模型、消耗模型额度。

## 分别验证能力

test 提醒可能消耗额度；每次最多一个请求，只发送工具包内置非私人样本：

- text：验证结构化计算结果；
- vision：验证本地生成图形的形状与颜色；
- transcription：验证本地合成英文测试录音的全文。

HTTP 200、模型列表可读或空响应不算通过。检测记录在数据卷 `ai-diagnostics/`，
文件权限 0600。更换配置后旧检测失效。usage 未返回时显示未知，不虚构余额和
账单。401/参数错误不盲目重试；超时可能已在远端计费，不自动补偿调用。

有限协议选项：`AI_TOKEN_PARAMETER=max_completion_tokens|max_tokens`、
`AI_TEMPERATURE_SUPPORTED=true|false`、`AI_JSON_MODE=json_object|prompt_only`、
`AI_TRANSCRIPTION_FORMAT=json|verbose_json|text`。按所选模型官方接口文档配置。
无时间戳的有效转写只显示全文，不制造逐句定位。

app/worker 一致接收 `AI_PROVIDER`、`AI_BASE_URL`、`AI_API_KEY`、
`AI_PROVIDER_LABEL`、三项模型、`AI_REQUEST_TIMEOUT_MS`、`AI_MAX_REQUEST_BYTES`、
`AI_MAX_RESPONSE_BYTES`。`AI_CONFIGURATION_ID` 是非秘密配置代号，使更换配置后的
旧任务、授权与检测失效；它不是 Key 的摘要。

## 同意与关闭

部署配置不等于同意外发。Web“设置 → AI 整理与隐私”和 App 设备设置显示
未配置、等待同意、未测试、通过/失败和后台服务可用性。只有家庭管理员能启用
或撤回逐能力同意；普通成员不能获得 Key 或编辑部署配置。授权前显示接收服务、
模型和内容类型；提交时重新校验配置版本与实时角色。旧页面不能为新服务授权。

关闭家庭同意会取消相关等待任务，运行中的任务不能再回填。`ftc ai disable`
在部署层关闭 AI 并重建 app/worker，残留配置不会重新开启 AI。已发出的远端请求
无法保证撤回；媒体、出版等非 AI 任务继续。升级保留配置与同意记录，配置变化
要求重新同意，不自动开启。

自动处理和历史补处理是不同授权：新照片/录音开关不能等同于授权处理后来补传
的旧库存。历史内容必须明确选择并预览范围；访客投递不默认外发。
完整命名采用、自动策略与历史流程仍在实施，验收见
[PRODUCT_1_4.md](PRODUCT_1_4.md)，不把运维切片当作全部 Organizer 已交付。

## 验证与兼容边界

- 已验证确定性协议、真实 SQLite 队列/配置失效、真实 loopback HTTP 三能力及
  multipart/redirect/429。两种生产模板已验证真实 app/worker、隐藏输入、注入
  防护、环境一致、语义检测、401 脱敏、重启与关闭。
- 复现：`python3 scripts/verify-ai-containers.py --image <本地测试镜像>`。
  只创建唯一命名的隔离项目与卷，使用合成样本及容器内 HTTP fixture。
  Caddy 模式未启动公网代理或签发证书。
- 未提供专用 live Provider 凭据；没有真实供应商/模型组合可标为通过。
  不扫描其他项目 Key，不默认发送家庭照片；live smoke 须明确授权。
- 真实手机相机、录音、签名安装与覆盖升级尚未验证；Expo export 不替代真机。
- 新接口为增量接口，旧客户端继续保存同步，不能绕过新增 AI 授权。
  新 App 遇旧服务端 404 提示升级；401/403 清除对应连接的 AI 状态缓存。
  不以卸载含唯一资料的旧 App 作为默认升级步骤。

家庭 portable archive 不含 Provider Key、检测文件、任务租约或设备授权。
实例快照可能含私密配置，必须受限保存；恢复不得自动处理历史 AI 任务。
本轮开发与发布不代表生产 VPS 已升级。

### 短视频的当前处理限额

仅手动处理最长 2 分钟、原件不超过 128 MiB 的 MP4、MOV 或 WebM。
画面使用受限抽帧；另选转录时，服务器本地提取第一条音轨为单声道 16 kHz
WAV（最多 4 MiB），不外发原视频文件或其元数据。没有音轨时说明原因，
画面分析仍可使用；时长未知或超限则不调用模型。

本地真实 ffmpeg + 数据库 + worker 已验证 120 秒边界、超限、无音轨、取消、
原件保留，以及拒绝素材内的网络播放列表。模型返回由确定性测试替身提供，
此证据不代表真实 Provider 的语音识别质量或手机实拍验收。

## 请求、配额与接收地址（2026-09-08）

`ftc ai configure` 的文字/图片默认地址为 `https://api.openai.com/v1`，
模型仍为 `gpt-5.6-luna`；也可填写自有 CPA 地址及合法模型别名。官方地址推荐
Responses profile，第三方按实际协议选 Responses 或 Chat，不只改域名。
MiMo 默认仍为 `mimo-v2.5-asr`，两条路由各自配置 Key、地址及模型。
更换地址会比较协议、主机、端口和租户路径，并要求确认接收方。
只改主路由时保留语音路由的同意身份；只改限额不要求重复同意。

所有真实模型请求（后台任务、明确提交的自然语言搜索、CLI 内置样本诊断）
共用部署级 UTC 日限额。`AI_DAILY_MAX_REQUESTS`、`AI_DAILY_MAX_IMAGES`、
`AI_DAILY_MAX_AUDIO_SECONDS` 为 0 或空时不限，但仍累计用量；Web/App 显示
“已使用 / 不限”或具体上限。音频按实际字节受限探测，正时长向上取整到秒；
无法确认时长则拒绝转写。非 WAV 输入超过本地 600 秒转换上限会明确失败，
不会截掉后半段后报告成功；MiMo 的编码大小上限也在请求前校验。

本地输入、出站目标、已取消请求先校验，随后原子预留并再次检查授权。
确认未发送的撤权/取消退回原记账日；已开始发送后超时、断线或进程崩溃仍
保守计数。重启遗留的预留也计数，因为无法证明服务商未收到；账本不是供应商
账单。达到限额的后台任务按现有重试时间等待；搜索和诊断不会自动反复调用。

“用一句话找”由按钮明确提交，GET、刷新、预取只读取结果。相同操作号只处理
一次；结果保留 24 小时，绑定账号、家庭、实例、筛选条件、接收配置与同意版本。
每账号每家庭每分钟最多 5 个转换意图。处理未完成或已失效时请检查状态后重新
明确提交。手动人物、日期、媒体、标签优先；未能唯一识别人物或模型返回非法
条件会明确失败。普通关键词链接仍可分享，读取时重新按权限过滤。

出站解析检查全部 DNS 地址，并固定已检查地址连接；不跟随重定向，保留 TLS
证书校验。内网 HTTPS 接收服务需由维护者在 `AI_ALLOWED_PRIVATE_TARGETS`
中明确列出完整 Base URL（逗号分隔），例如
`https://nas.example.internal/tenant/v1`。明确配置的本机 loopback 服务继续可用。
批准某个服务不会批准同机其他端口或租户路径。
