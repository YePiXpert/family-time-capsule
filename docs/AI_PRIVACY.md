# AI 隐私与外部处理边界

> 当前状态：**安全启用基础设施已实现，真实素材处理器已扩展至图片视觉分析**。仓库已有
> provider-neutral 适配器、SQLite job queue、独立 worker、`/settings/ai`
> 披露与逐能力同意。production handler registry 已注册 `transcribe.asset.v1`
>（音频/视频转录）与 `analyze.asset_image.v1`（图片视觉分析），只有具备 `ai:review`
> 能力的用户才能逐项触发；即使配置 `AI_PROVIDER` 并完成同意，系统仍不会自动扫描或发送其他家庭资料。

## 1. 原则

1. 家庭档案默认私有，外部 AI 必须明确 opt-in。
2. AI 是可替换的整理工具，不拥有记忆；原件和用户确认内容不依赖 AI 存活。
3. 处理前必须显示供应商、模型和即将发送的内容类型。
4. 只发送完成当前任务所需的最小内容；权限、家庭隔离和可见性在调用前执行。
5. AI 结果默认是可再生衍生物或待审核建议，永远不是 `user_confirmed` Fact。
6. 用户编辑后的 transcript、确认过的 Fact、已发布 Story 与来源属于耐久资料，
   后续 AI 重跑不得覆盖。
7. 没有 Provider、模型不可用或 worker 停止时，核心档案仍然可用。

## 2. 当前会与不会发生什么

当前会发生：

- 服务端可解析显式 AI 环境配置；
- `NullMemoryAssistant` 保持 AI 关闭；
- 测试可使用完全离线、可复现的 Fake；
- 开发者可用注入的内存传输验证兼容协议。
- 登录成员可在 `/settings/ai` 查看 Provider、模型、本机/外部边界和各能力会发送
  的内容类型；只有 admin 能启用或撤销逐能力同意；
- admin/editor 可查看家庭作用域 job 状态并取消或重试允许的任务；
- 具备 `ai:review` 的用户可在记忆详情页为音频/视频原件请求 AI 转录，或为图片原件请求 AI 视觉分析；
- 转录结果存入独立的 `asset_transcript` 表，用户修订后的文本不会被 AI rerun 覆盖；
- 图片分析结果存入独立的 `asset_analysis` 表，仅作为可重建的未确认参考，不进入 portable family archive；
- SQLite 保存有界的 job、source fingerprint、attempt、lease 与 worker heartbeat
  运维元数据，worker 可恢复过期租约并安全退避重试；
- 入队、领取、续租和提交结果时都会重验账号、角色、家庭、来源指纹、可见性、
  Provider/model 与 consent version。

当前不会发生：

- 自动扫描、上传或转录任何原始媒体（转录必须人工逐项触发）；
- 从 Inbox、Contribution、Capsule、Story 或时间轴读取资料交给 AI；
- 执行 suggestion 或 embedding job；这些 handler 将在对应业务切片实现后逐项注册；
- AI 自动确认 Fact 或覆盖用户修订的转录文本；
- 在 SQLite 保存 API key；
- 在导出 archive 包含 API key；
- 在浏览器返回 provider 配置对象或密钥；
- 自动生成、接受或确认 Fact；
- 运行第三方 analytics。

## 3. 密钥边界

`AI_API_KEY` 只允许来自服务端环境变量。代码边界如下：

- 公开入口 `lib/ai/index.ts` 不导出联网配置工厂；密钥入口在
  `lib/ai/server.ts`；
- `NEXT_PUBLIC_AI_API_KEY` 与 `NEXT_PUBLIC_OPENAI_API_KEY` 会被明确拒绝；
- `AiSecret` 的字符串转换、JSON 和普通对象检查均显示 `[REDACTED]`；
- 只有组装 `Authorization: Bearer …` 时才显式读取原值；
- key 不进入 URL、JSON/multipart 正文或结果 provenance；
- 适配器不记录请求头，也不把底层 transport 异常或 provider 错误正文挂到
  应用错误的 message/cause；
- 错误只保留安全 code、能力、HTTP 状态、是否可重试，以及远端 request id 的
  单向 SHA-256 短指纹；永不暴露远端可控的原始响应头值。

这些措施保护应用自身的错误与日志路径，但不能替代部署安全：容器平台、反向
代理、APM、崩溃转储和管理员仍可能看到环境变量或请求头。生产环境必须使用
部署平台的 secret 注入，限制进程/日志访问，禁止 HTTP header/body debug
logging，并按供应商要求轮换 key。

## 4. 传输安全

当前 OpenAI-compatible 适配器：

- 远程 `AI_BASE_URL` 强制 HTTPS；明文 HTTP 只允许 loopback；
- URL 不允许内嵌 credentials、query 或 fragment；
- `redirect: error`，避免 Bearer header 被跟随到另一个地址；
- `credentials: omit`、`cache: no-store`；
- 每次请求有超时，也接受调用者取消信号；
- 序列化请求与流式响应都有字节上限；声明或实际超限都会停止读取；
- 只接受 JSON media type、有效 UTF-8、合法 JSON 和逐字段 schema；
- multipart 转录使用中性文件名（例如 `audio.mp3`），不会把家庭原文件名交给
  provider。

`AI_BASE_URL` 是管理员信任边界。应用尚未为它实现 DNS/IP SSRF allowlist；
因此当前没有 UI 可以让普通成员修改地址。未来若增加 UI 管理，必须先完成
管理员权限、审计、加密 secret 存储或外部 secret manager，以及专门的 SSRF
威胁模型，不能把明文 key 写进 SQLite。

## 5. 已实现的启用门禁与后续业务门禁

基础适配器存在不等于外部 AI 已获准使用。当前 foundation 已实现前四项基础
门禁；任何真实素材 handler 上线时还必须完成该能力对应的结果、来源与端到端
门禁：

1. **显式同意**：家庭管理员启用外部处理，记录同意版本；可随时关闭。
2. **逐次披露**：显示 Provider、Model，以及会发送文本、图片、音频还是已有
   transcript；不能只写模糊的“AI 整理”。
3. **授权与隔离**：在 job 入队和实际执行时都重新检查 family、role、资源
   ownership、Contribution visibility 与 AI processing policy。
4. **内容最小化**：只传任务必需片段；禁止无界上下文、整个 archive 或无关
   家庭成员资料。
5. **审核工作流**：结果只能进入 `ai_suggested`/draft；接受与拒绝可追踪，拒绝
   内容不能进入 Story。
6. **来源锁**：每条 Fact/Story 段落保留允许的真实来源；AI 不得制造引号内
   原话、时间、人物或医疗事实。
7. **耐久 job**：SQLite 队列、幂等键、租约、重试/backoff、失败 UI、worker
   崩溃恢复，并保证失败不改原件。
8. **审计最小化**：记录谁在何时对哪个资源启动/取消何种能力及 provider/model，
   但不记录正文、完整 transcript、图片描述全文、请求 body 或 token。
9. **保留与删除**：说明本地衍生物与 provider 端保留政策；支持重建/删除机器
   输出，不误删用户编辑内容。
10. **端到端验证**：AI disabled、provider outage、跨家庭/不可见资源、用户编辑
    transcript 后重跑、拒绝建议、备份恢复等真实路径全部通过。

同意绑定当前实例的 Provider id、model、披露版本和递增 consent version。更换
Provider/model、撤销同意、账号禁用/降权、guardian/visibility 改变或来源内容
指纹变化，都会让旧 job 在执行或完成前 fail closed；不会把旧同意静默套到新
配置。

当前已完成 queue/consent/worker 的离线和浏览器门禁验证；STT、vision、建议、
Story 来源锁等业务能力必须在各自上线前补完第 5、6、9、10 项，产品 UI 不得
提前宣称这些能力已可处理真实素材。

## 6. 数据分类

| 数据 | 分类 | 导出/恢复原则 |
| --- | --- | --- |
| 原始照片/视频/音频/文档 | 不可变原件 | 必须完整保留，AI 永不覆盖 |
| `AI_API_KEY` | secret | 不入库、不导出、不发客户端 |
| AI consent | 当前实例的外部处理授权 | 与当前 Provider/model 绑定；不随家庭 archive 导出或自动恢复，恢复实例须由 admin 重新同意 |
| job / source fingerprint / attempt / worker heartbeat | 运维衍生元数据 | 不进入 portable family archive；可取消、过期或重建，不是家庭记忆的唯一来源 |
| 原始机器分析/未编辑机器 transcript | 可再生衍生物 | 存入 `asset_transcript.rawTranscript`，随家庭 archive 导出以保留 fidelity，但仍是可重建衍生；provider/model 更换后可安全丢弃并重建 |
| 图片视觉分析 (`asset_analysis`) | 可再生衍生物 | **不进入 portable archive**；可通过重跑 `analyze.asset_image.v1` 重建；UI 始终标注「AI 生成 · 未确认」 |
| embedding / FTS index | 可再生索引 | 不作为唯一数据源，provider/model 更换可重建 |
| `asset_transcript` 用户编辑 editedTranscript | 耐久家庭资料 | 必须导出/恢复，AI 重跑不得覆盖 |
| 用户确认 Fact | 耐久事实 | 必须带来源导出/恢复，AI 不得直接创建 |
| 已发布 Story 与段落来源 | 耐久家庭资料 | 必须导出/恢复、保持可追溯 |

## 7. 日志与测试

任何日志都禁止包含：Contribution 正文、transcript 全文、照片描述全文、API
key、Authorization header、原始媒体 URL/token、请求/响应 body。允许的最小
运行信息是：匿名 job id、family/resource 的内部不透明 id、能力、provider/model、
状态、耗时、重试次数和安全错误 code；实际接入日志前还要经过安全审计。

CI 只使用离线 Fake 和合成的几字节媒体，禁止真实 key、真实 endpoint、真实
家庭文本或素材。测试必须能在断网环境重现，不消耗真实 API 配额。

## 8. 外部供应商责任

一旦未来获得明确同意并启用外部 AI，内容会离开本机并受所选供应商的存储、
训练、地域、子处理方与删除政策约束。管理员必须在启用前核对供应商条款并向
家庭成员披露；应用不能因为“OpenAI-compatible”协议相同，就假设隐私政策、
能力或数据保留相同。

具体配置与协议限制见 [AI_PROVIDERS.md](./AI_PROVIDERS.md)。
