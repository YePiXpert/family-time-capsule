# App 内部 MiMo 适配与上线边界

## 2026-09-22：升级至 V2.6（待生产切换）

主人要求将 App 的云端 AI 全部切换至小米新模型。已核对[官方 V2.6 发布说明](https://mimo.mi.com/docs/zh-CN/news/latest/v2-6)及 [Chat Completions API](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api)：文字、图片、分组与全部写作模式使用 `mimo-v2.6-flash`；专用转写仍为 `mimo-v2.5-asr`。保留现有提示词、逐模式思考策略、16384 completion token 上限、严格 JSON／业务校验和无跨供应商回退。

旧客户端传来的 `mimo-v2.5` 和 DeepSeek 型号仍归一到新内容模型；本机 AI 任务标记和供应商脚注更新为 V2.6 Flash。iPhone 本机识别优先策略及上传范围保持不变。服务端切换无需重发安装包；安装包内脚注须等下次出包更新。

截至准备阶段，生产仍运行 `b76439d`（DeepSeek 文字 + MiMo ASR），项目 secret 目录仅发现既有 Token Plan MiMo key。已向主人请求可用于 App 的匹配密钥路径；未调用真实上游或修改生产配置。下面是 2026-09-21 的适配和部署约束记录，V2.5 内容型号由本节 V2.6 Flash 替代。

2026-09-21。只改桉桉成长记的内容模型，开发代理配置不变。没有新增视频、TTS 或通用模型平台，没有发布新安装包。

## 凭证核对与阻塞项

截至本次只读核对，生产镜像为 `anan-ai:b76439de5ce8b9e72080ffdd4eecfb2f5918f54b`：

| 路径 | 现网模型／地址 | 凭证与只读挂载 |
| --- | --- | --- |
| 内容 | `deepseek-flash` / `https://api.deepseek.com` | 普通 API 类型；`/opt/anan-ai/secrets/deepseek-key` → `/run/secrets/cpa-key` |
| ASR | `mimo-v2.5-asr` / `https://token-plan-cn.xiaomimimo.com/v1` | Token Plan 类型；`/opt/anan-ai/secrets/mimo-key` → `/run/secrets/transcribe-key` |

两个 secret 文件权限均为 0600；未打印值。前缀识别只用于区分套餐类型，不能证明普通 Key 属于哪家供应商或证明调用获准。

[官方订阅说明的套餐使用节](https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/subscription) 限制套餐用于编程工具，禁止自定义应用后端。此前能返回响应不构成使用许可。本次不再调用现有套餐、不更改或停止现网 ASR。

**阻塞项：内容和 ASR 两路分别需要适用于本 App 的官方特别许可，或主人明确授权普通按量 API 的费用并提供配套普通凭证。** 不购买、充值或将失败请求切到普通余额；不伪装编程工具。`*_ACCESS` 是操作人已核验授权的配置记录，不是授权凭证本身。未满足时保持离线验收，不运行 `--allow-live`，不部署。

## 实现与契约

- 内容提供商固定 MiMo，模型固定 `mimo-v2.5`，包括文字、图片、分组／合并、追问、润色、寄语和目录，不接受 Pro。
- `ai-config.ts` 将提供商、固定模型、地址、secret 文件及授权类型成组校验，启动数据库前校验失败即退出；每次调用重读 secret 并检查套餐类型。普通 API 配 `https://api.xiaomimimo.com/v1` 和普通 Key，套餐特许才配对应 Token Plan 地址和套餐 Key。两路配置不互相继承，旧 CPA 变量没有隐式别名。
- `ai-model.ts` 集中定义本次初始策略：question／letter／ask／polish disabled；group（含 merge）／generate／recap／editor enabled。此策略未被实测证明最优。
- [Chat Completions 文档](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api)：使用 `max_completion_tokens=16384`，为思考和最终 JSON 共用；不再发送 `reasoning_effort`／`max_tokens`／采样参数。年度目录没有缩小预算。
- [结构化输出](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/structured-output)：非流式 `response_format={type:json_object}`；只有 `finish_reason=stop`、非空合法最终 `message.content` 且通过原 `parseResult` 才成功。推理内容不进入记录，不以补字段、丢图片、放宽 ID／引用校验来成功。错误体不输出、不重试或换供应商，重定向也拒绝。
- [图片理解](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/multimodal-understanding/image-understanding)：保留每张缩略图 data URL、photoId、日期及匿名地点组，移除未确认的 `detail`；不上传原图、公开图床或整库。
- ASR 模型、WAV 转换、体积／时长限制、临时文件清理、逐段同意与 iPhone 本机优先保持。只是显式独立配置和凭证校验，不做自动润色。
- 八条提示词原文未改。AI 同意说明未写死原供应商，ASR 同意说明已注明小米 MiMo，故不改同意版本或数据范围。只更新两个供应商脚注和草稿 AI 任务模型标记，避免复用旧模型未完成步骤；本机库／同步／备份／正式记录不变。
- 老客户端发来的 DeepSeek 与更早模型选择仍接收并归一为 MiMo；新版 `/ai/config` 返回准确的逐模式策略。现有安装包的静态旧供应商脚注须在后续明确要求出包时更新，不能因服务端更新自动变化。
- 定时备份直接 exec 当前 `anan-ai-ai-1`，避免尚未部署的新 Compose 必填字段阻塞旧服务的备份；备份命令、SQLite 格式和保留七份的规则不变。

## 离线验收

`server/tests/provider.test.ts` 覆盖全部八模式、纯文字、单图、多图与 merge；成功／空结果／截断／非法 JSON／字段／未知照片与记录 ID／虚构引语；401、403、429、5xx、连接失败、超时及无回退。`ai-config.test.ts` 覆盖错误模型／厂商／地址／授权／密钥搭配不发请求，ASR 独立配置，套餐耗尽不落入按量接口，以及探针默认拒绝。原 ASR、产品提示词、移动端同意与同步回归继续运行。

必跑门禁：server `npm test`、`npm run typecheck`；mobile `npm test`、`npm run typecheck`、`npm run lint`；本机边界脚本及其 Python 单测。Compose 用纯假配置做 `config` 解析，secret 示例和真实环境分开；不创建生产或真实上游测试容器。

## 取得授权后的有限探测与部署方案（本次未执行）

1. 分别核验两路 App 使用许可及费用授权。普通 API 和 Token Plan 的 Key／URL 不混用；把特别许可证据留在私有运维记录，不放家庭资料或 Key 到仓库。以 `deploy/.env.example` 创建独立 staging env，明确填写授权；空的 ACCESS 值必须保持阻止启动，不能为了通过检查随意填入。
2. 从获准上线的完整 main 提交构建新镜像，用独立数据目录和 3141 端口启动 staging；数据、账号不能复用生产。对实际 env 的 Compose 展开结果只核对地址／路径，禁止输出密钥。先校验 Node 启动配置与 secret 挂载配对。
3. 只用仓库几何图形、合成文字和两秒测试录音。`probe.ts --allow-live` 固定 2 次看图；`probe-text.ts --allow-live` 固定 6 次文字（每模式一次，含 editor 和两种思考状态）；`verify-service.py --allow-live --container anan-ai-staging-ai-1` 最多 6 次内容 + 1 次 ASR，合计最多 15 次首次上游调用，不循环补测或自动重试。内容请求每次 completion 上限 16384，最大合计上限 229376；ASR 限一次两秒录音。失败就记录阻塞并停止后续批次，不自动购买或回退。预算上限不是必然用量或费用报价，执行前由主人批准。
4. 探测只保留模型、模式、状态、耗时、用量／固定错误码；不保留家庭内容、Key、生成内容、完整上游响应。文本探针的 total tokens 与服务路由的用量差值用于审计；ASR 若上游不提供 token 用量，以测试音频 2 秒记录。真实内容质量和速度仍需授权后的合成样例验收，Mock 不代表模型一定不编造。
5. staging 通过后才准备生产变更：保存旧镜像 ID、旧完整 env 和 **旧 Compose 文件副本**（例如从 `b7eefdf` 取），停止写入后备份 `/opt/anan-ai/data`，记录权限与校验和。旧 Compose 已不再等于 main 的新配置，回滚不能只替换模型名。
6. 将获准的独立配置与目标 SHA 应用到生产，使用已验证镜像 `up -d --no-build --pull never`。核对本机／公网健康 SHA、容器健康、匿名鉴权、账号／设备／设置／备份清单保留。生产不用会建测试账号的 verify-service；两台真机验证仍须主人参与。
7. 失败时用保存的**旧镜像 + 旧完整 env + 旧 Compose**显式回滚并核对健康 SHA；无数据库结构修改，不自动还原旧数据以免覆盖新增内容。不得在请求中静默跨供应商发送家庭资料。ASR 的既有许可问题仍需单独解决，回滚不是许可证明。

## 本次验证结果

- server：189 项测试全部通过（含原 ASR 回归），`npm run typecheck` 通过；探测脚本也纳入 TypeScript 检查。
- mobile：51 文件／784 项测试通过，typecheck、lint 通过；本机边界检查及 11 项 Python 脚本单测通过。
- Compose 假配置展开与缺失字段拒绝通过，没有启动容器；八条提示词文本逐字未变。
- 备份脚本 `sh -n` 及隔离假 Docker 演练通过（调用运行中容器、移动备份、0600 权限、保留七份），未运行生产备份。
- 本次只读复核生产 container ID、镜像 ID 和启动时间均未变，容器健康。部署数据、实际 env／secret、开发代理配置未改。
- 真实 API、模型质量／性能、生产切换及真机：未执行，受上述凭证许可与费用授权阻塞。
