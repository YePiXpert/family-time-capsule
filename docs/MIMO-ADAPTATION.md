# App 内部 MiMo 适配与上线边界

## 2026-09-22（晚）：1.0.3 减法版服务端已部署

生产镜像已换为 `anan-ai:8be3a46731b56f17fec0bdbb8aa12575ddefc96b`（发版提交，13:52 UTC 从 `e2bd07f` 切换）：服务端只剩 `POST /api/v1/ai/write` 与五个 writingMode（polish／recap／ask／question／editor），`photos` 必须为空数组，不再向模型发送图片；`/ai/group`、`generate`、`letter` 与 ASK 的故事主题句已删除，旧 1.0.2 手机的对应功能得到 400／404。模型、地址、密钥、思考策略、16384 completion token 上限与严格 JSON 校验不变。

同一镜像先在独立数据目录的 staging 3141 用 `verify-service.py --allow-live` 真实验证：ask 3.1 s／593 tokens、question 7.5 s／490、polish 1.5 s／565（重放 0 tokens）、recap 34.6 s／2191、editor 11.9 s／1104，转写 2 秒合成音 5.6 s／77 tokens；带照片的 ask、`generate` 与 `/ai/group` 分别 400／400／404 且不上游；账号、幂等、家庭备份、设备撤销与临时文件清理通过，测试容器已清理。生产切换前 tar 备份数据并记录四表逐行摘要，切换后本机／公网 healthz 均为发版提交、匿名接口 401、既有行逐行一致。私有运维记录：`/opt/anan-ai/deployments/20260922-1.0.3-reduction/`。下面的 V2.6 Pro 部署记录保留为历史。

## 2026-09-22：MiMo V2.6 Pro 已部署（历史；镜像已被上节取代）

主人要求将 App 的云端 AI 全部切换至小米新模型。已核对[官方 V2.6 发布说明](https://mimo.mi.com/docs/zh-CN/news/latest/v2-6)及 [Chat Completions API](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api)：文字、图片、分组与全部写作模式使用 `mimo-v2.6-pro`；专用转写仍为 `mimo-v2.5-asr`。保留现有提示词、逐模式思考策略、16384 completion token 上限、严格 JSON／业务校验和无跨供应商回退。

旧客户端传来的 `mimo-v2.5` 和 DeepSeek 型号仍归一到新内容模型；本机 AI 任务标记和供应商脚注更新为 V2.6 Pro。iPhone 本机识别优先策略及上传范围保持不变。服务端切换无需重发安装包；安装包内脚注须等下次出包更新。

主人随后明确选择 `mimo-v2.6-pro`，并私下提供服务地址与套餐密钥；具体值不写入部署记录。密钥仅保存于服务端权限 0600 的文件，两路显式配置并独立只读挂载。`token-plan-authorized` 记录这次主人的使用选择。生产镜像为 `anan-ai:e2bd07fe77f5b185257ef1fc255462245a4d1577`，已替换原 `b76439d`。

验证结果：

- 本地 mobile 727、server 189 项测试，以及两端类型检查、移动端 lint、11 项 Python 检查和本机边界检查通过。
- 直接上游探测覆盖 group、generate、ask、question、letter、editor、polish、recap 共八模式，全部成功；测试只使用仓库几何图与合成文字，不发送家庭内容。简单文字样例约 1.5–3 秒，年度目录样例约 45 秒；不是所有请求的延迟承诺。
- 同一镜像在独立 staging 完成六次内容调用、一次两秒合成音频转写，以及账号鉴权、幂等重放、家庭备份、设备撤销和音频清理检查；未改动生产账号来做测试。测试容器与合成数据已清理。
- 生产暂停写入后保存数据 tar 和 SHA-256；保存旧镜像 ID、完整 env 与旧 Compose。第一次检查把预期的模型字段归一误判为设置变化，已自动回滚；修正为仅允许 defaultModel／enabledModels 更新后再次切换成功。
- 本机／公网 healthz 均为上述完整 SHA；匿名账号接口仍返回 401。既有成员、设备、非模型设置及备份清单核对保留。服务仅接受 `mimo-v2.6-pro` 内容模型，ASR 为 `mimo-v2.5-asr`，两路均使用主人指定的中国 Token Plan 地址；无 DeepSeek 回退。
- 私有运维记录：`/opt/anan-ai/deployments/20260922-mimo26-pro/`。此处保存探测统计、部署结果、原配置和数据备份；密钥只在 secret 文件中。源码脚注已更新，现有安装包的静态文案仍需下次出包更新；此次未发布新安装包。


## 历史记录：2026-09-21 的离线适配边界

以下为当时仅完成离线适配的记录；本次目标型号、主人指示及实际部署状态以上节为准。

2026-09-21。只改桉桉成长记的内容模型，开发代理配置不变。没有新增视频、TTS 或通用模型平台，没有发布新安装包。

## 凭证核对

截至本次只读核对，生产镜像为 `anan-ai:b76439de5ce8b9e72080ffdd4eecfb2f5918f54b`：

| 路径 | 现网模型／地址 | 凭证与只读挂载 |
| --- | --- | --- |
| 内容 | `deepseek-flash` / `[服务地址已省略]` | 普通 API 类型；`/opt/anan-ai/secrets/deepseek-key` → `/run/secrets/cpa-key` |
| ASR | `mimo-v2.5-asr` / `[服务地址已省略]` | Token Plan 类型；`/opt/anan-ai/secrets/mimo-key` → `/run/secrets/transcribe-key` |

两个 secret 文件权限均为 0600；未打印值。前缀识别只用于区分套餐类型，不能证明普通 Key 属于哪家供应商。

`*_ACCESS` 记录主人的使用选择。普通按量 API 需要主人明确授权费用并提供配套凭证；不自动购买、充值或将失败请求切到普通余额。

## 实现与契约

- 内容提供商固定 MiMo，模型固定 `mimo-v2.5`，包括文字、图片、分组／合并、追问、润色、寄语和目录，不接受 Pro。
- `ai-config.ts` 将提供商、固定模型、地址、secret 文件及授权类型成组校验，启动数据库前校验失败即退出；每次调用重读 secret 并检查套餐类型。普通 API 配 `[服务地址已省略]` 和普通 Key，Token Plan 配对应套餐地址和套餐 Key。两路配置不互相继承，旧 CPA 变量没有隐式别名。
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

1. 分别核对两路配置与主人的使用选择及费用授权。普通 API 和 Token Plan 的 Key／URL 不混用；不放家庭资料或 Key 到仓库。以 `deploy/.env.example` 创建独立 staging env，明确填写授权；空的 ACCESS 值必须保持阻止启动，不能为了通过检查随意填入。
2. 从获准上线的完整 main 提交构建新镜像，用独立数据目录和 3141 端口启动 staging；数据、账号不能复用生产。对实际 env 的 Compose 展开结果只核对地址／路径，禁止输出密钥。先校验 Node 启动配置与 secret 挂载配对。
3. 只用仓库几何图形、合成文字和两秒测试录音。`probe.ts --allow-live` 固定 2 次看图；`probe-text.ts --allow-live` 固定 6 次文字（每模式一次，含 editor 和两种思考状态）；`verify-service.py --allow-live --container anan-ai-staging-ai-1` 最多 6 次内容 + 1 次 ASR，合计最多 15 次首次上游调用，不循环补测或自动重试。内容请求每次 completion 上限 16384，最大合计上限 229376；ASR 限一次两秒录音。失败就记录阻塞并停止后续批次，不自动购买或回退。预算上限不是必然用量或费用报价，执行前由主人批准。
4. 探测只保留模型、模式、状态、耗时、用量／固定错误码；不保留家庭内容、Key、生成内容、完整上游响应。文本探针的 total tokens 与服务路由的用量差值用于审计；ASR 若上游不提供 token 用量，以测试音频 2 秒记录。真实内容质量和速度仍需授权后的合成样例验收，Mock 不代表模型一定不编造。
5. staging 通过后才准备生产变更：保存旧镜像 ID、旧完整 env 和 **旧 Compose 文件副本**（例如从 `b7eefdf` 取），停止写入后备份 `/opt/anan-ai/data`，记录权限与校验和。旧 Compose 已不再等于 main 的新配置，回滚不能只替换模型名。
6. 将获准的独立配置与目标 SHA 应用到生产，使用已验证镜像 `up -d --no-build --pull never`。核对本机／公网健康 SHA、容器健康、匿名鉴权、账号／设备／设置／备份清单保留。生产不用会建测试账号的 verify-service；两台真机验证仍须主人参与。
7. 失败时用保存的**旧镜像 + 旧完整 env + 旧 Compose**显式回滚并核对健康 SHA；无数据库结构修改，不自动还原旧数据以免覆盖新增内容。不得在请求中静默跨供应商发送家庭资料。

## 本次验证结果

- server：189 项测试全部通过（含原 ASR 回归），`npm run typecheck` 通过；探测脚本也纳入 TypeScript 检查。
- mobile：51 文件／784 项测试通过，typecheck、lint 通过；本机边界检查及 11 项 Python 脚本单测通过。
- Compose 假配置展开与缺失字段拒绝通过，没有启动容器；八条提示词文本逐字未变。
- 备份脚本 `sh -n` 及隔离假 Docker 演练通过（调用运行中容器、移动备份、0600 权限、保留七份），未运行生产备份。
- 本次只读复核生产 container ID、镜像 ID 和启动时间均未变，容器健康。部署数据、实际 env／secret、开发代理配置未改。
- 真实 API、模型质量／性能、生产切换及真机：未执行。
