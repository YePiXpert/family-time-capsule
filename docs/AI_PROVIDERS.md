# AI Provider 配置与适配器

> 当前状态：**Provider、同意与后台任务基础设施已实现，真实 AI handler
> 已扩展至图片视觉分析**。`lib/ai/` 提供 provider-neutral 接口、关闭实现、离线 Fake 和
> OpenAI-compatible 传输层；`lib/ai/jobs/`、`jobs/` 与 `/settings/ai` 提供
> SQLite queue、worker、披露和同意控制。production handler registry 已注册
> `transcribe.asset.v1`（音频/视频转录）与 `analyze.asset_image.v1`（图片视觉分析），
> 其余能力（suggestion、embedding）仍为空，不会自动处理家庭资料。

## 1. 架构边界

业务代码只依赖 `MemoryAssistant`，不依赖 OpenAI、Kimi、GLM、Grok、
Anthropic 或任何特定 SDK：

```text
已授权的应用服务 / SQLite worker
                  │
                  ▼
          MemoryAssistant（聚合接口）
        ┌─────────┼──────────┬────────────┐
        ▼         ▼          ▼            ▼
      text      vision  transcription  embeddings
        │         │          │            │
        ├─────────┴──────────┴────────────┤
        ▼                                 ▼
Null / Deterministic Fake       OpenAI-compatible adapter
```

能力接口分别是：

- `TextGenerationProvider.generateText()`；
- `VisionProvider.analyzeImage()`；
- `TranscriptionProvider.transcribeAudio()`；
- `EmbeddingProvider.createEmbeddings()`。

每个结果都带 `providerId`、面向用户的 `providerName` 和实际/回退
`model`，供同意界面、来源记录和审计使用。接口不接收数据库实体，也不能写入
Fact；AI 输出是否形成可审核建议，由后续业务服务决定。

## 2. 三种当前实现

### `NullMemoryAssistant`

默认实现。不访问网络、不读取素材，也不要求 API key。四项能力都返回
`available: false`；错误调用会以 `ai_capability_unavailable` 明确失败，
不会偷偷回退到另一个模型。核心捕获、Inbox、时间轴、家庭协作、导出与恢复
不得依赖 AI，因此 AI 关闭时仍然正常工作。

### `DeterministicFakeMemoryAssistant`

只用于自动化测试和本地开发：

- 不访问网络；
- 不读取环境变量；
- 相同 seed 与输入得到逐字节一致的文本、图片分析、转录和向量；
- 可单独关闭任一能力，用于模拟模型缺失/故障；
- 不回显完整输入，只返回输入指纹派生的明显 Fake 文本；
- 向量维数固定且可配置。

Fake 输出永远不得进入生产档案或伪装成用户确认内容。

### `OpenAiCompatibleMemoryAssistant`

这是一个协议适配器，不是对任何厂商能力的背书。当前使用：

| 能力 | 相对 `AI_BASE_URL` 的端点 |
| --- | --- |
| text | `chat/completions` |
| vision | `chat/completions`（data URL 图片输入） |
| transcription | `audio/transcriptions`（multipart） |
| embeddings | `embeddings` |

适配器采用 Bearer 认证，拒绝 HTTP 重定向，设置调用超时，限制序列化请求与
流式响应字节数，并验证 Content-Type、UTF-8、JSON 和每项返回字段。HTTP
错误正文与底层 `fetch` 异常不会进入应用错误，避免反向代理把请求头/密钥
回显进日志。远端返回的 request id 也只保留单向 SHA-256 指纹，防止恶意端点
把已看到的 Bearer key 反射进这个看似安全的日志字段。

不同“OpenAI-compatible”服务在参数、响应结构、文件上限和模型能力上仍可能
不同。正式接入某个服务前，必须用不含家庭资料的合成数据做兼容性验证。

## 3. 环境变量（仅服务端）

所有值在运行时读取，禁止增加 `NEXT_PUBLIC_` 前缀。

| 变量 | 规则 |
| --- | --- |
| `AI_PROVIDER` | 未设置、`disabled` 或 `none` 表示关闭；唯一启用值是 `openai-compatible` |
| `AI_BASE_URL` | 启用时必填；可包含 `/v1` 路径；不得含账号、密码、query 或 fragment；远程地址必须 HTTPS，HTTP 仅允许 loopback |
| `AI_API_KEY` | 启用时必填；只用于发送 Bearer 请求；不得写入数据库、页面、日志、测试 fixture 或导出 |
| `AI_PROVIDER_LABEL` | 可选的用户可读供应商名称，默认 `OpenAI-compatible endpoint` |
| `AI_MODEL` | **仅**开启 text；不会让 vision 自动可用 |
| `AI_VISION_MODEL` | **仅**开启 vision |
| `AI_TRANSCRIPTION_MODEL` | **仅**开启 transcription |
| `AI_EMBEDDING_MODEL` | **仅**开启 embeddings |
| `AI_REQUEST_TIMEOUT_MS` | 默认 `30000`，允许 `50`–`120000` |
| `AI_MAX_REQUEST_BYTES` | 默认 `33554432`，允许 `4096`–`104857600` |
| `AI_MAX_RESPONSE_BYTES` | 默认 `4194304`，允许 `1024`–`16777216` |
| `AI_WORKER_POLL_MS` | worker 空闲轮询间隔，默认 `1000`，允许 `50`–`60000`；不影响请求超时 |

启用适配器时至少要明确配置一个能力模型。模型之间没有继承关系，也不会请求
`/models` 后猜测能力；这可避免把“能生成文本”错误等同于“能看图/转录/生成
向量”。关闭时如果残留非空 provider 设置，启动配置解析会失败，而不是静默
忽略一个可能被误以为已经生效的配置。

示例（只展示占位符，绝不提交真实值）：

```dotenv
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://provider.example/v1
AI_API_KEY=<set-in-deployment-secret-store>
AI_PROVIDER_LABEL=Example private AI
AI_MODEL=<text-model-id>
AI_VISION_MODEL=<vision-model-id>
# 未配置的能力保持关闭
```

服务端构造方式：

```ts
import { createMemoryAssistant } from "@/lib/ai/server";

const assistant = createMemoryAssistant();
if (assistant.supports("vision")) {
  // 未来必须先经过家庭授权、可见性与 AI processing policy，再调用。
}
```

`lib/ai/index.ts` 只导出协议、Null/Fake 和安全错误类型。读取密钥及联网的工厂
位于明确的 `lib/ai/server.ts` 入口；运行时也会拒绝在浏览器中构造提供商。

## 4. 同意、队列与 worker

- `/settings/ai` 向登录家庭成员显示 Provider、model、是否离开本机及每项能力会
  发送的内容类型；只有 admin 可以启用或撤销 consent。
- consent 按 family + capability 保存，并绑定 Provider id、model、披露版本和
  consent version。Provider/model 变化不会继承旧同意。
- automatic job 只允许完全 `family` 可见的来源；`private`、`parents` 与
  `child_later` 只能由当前有权用户逐项手工触发。
- queue 的 payload/output 固定为 `{}`；正文、媒体、secret 和 Provider response
  不进入 job 表。source 表只保存受控实体 id 与 SHA-256/fingerprint。
- worker 在 claim、续租、提交结果前重验 live actor、family、visibility、来源
  指纹、Provider/model 与 consent；租约使用 generation fencing，过期 worker
  不能迟到提交。
- 业务 handler 必须用 worker 提供的 transaction-scoped commit callback，把衍生
  结果写入与 job 完成放在同一事务；直接把 Provider 输出写进 queue 是禁止的。

开发环境运行：

```bash
npm run worker
npm run worker:once
```

生产构建通过 `npm run build:ops` 生成 `.next/ops/worker.mjs`；Compose 的 `worker`
service 与 app 共享 `/data` 和同一组 AI 环境变量。worker 停止、Provider 失效或
所有 capability 关闭，都不影响上传、Inbox、Timeline、Contribution、Capsule、
导出和恢复。

当前 registry 已注册 `transcribe.asset.v1`（音频/视频转录）与
`analyze.asset_image.v1`（图片视觉分析），其余真实 handler（suggestion、embedding）
会随对应的数据模型和审核流程一起注册，不能仅为了“能调用接口”而绕过来源和事实锁。

## 5. 输入与响应限制

除可调的 HTTP 请求/响应上限外，协议层还有固定的逐能力输入上限：

- 文本：最多 64 条消息、每条最多 100,000 字符、总计最多 1 MiB UTF-8；
- 图片：只接受 JPEG/PNG/WebP/GIF，原始字节最多 20 MiB；
- 音频：只接受列明的 FLAC/M4A/MP4/MP3/OGG/WAV/WebM，最多 25 MiB；
- 向量：一次 1–256 条，每条最多 20,000 字符，总计最多 1 MiB UTF-8；
- 兼容层返回的向量必须数量一致、索引唯一、维数一致且全部为有限数值。

这些是应用安全上限，不代表某个供应商一定接受同样大小。通用 job 的租约、重试
与 crash recovery 已实现；长音频分片、部分失败恢复和真实 STT 结果持久化属于
后续 transcript 里程碑。

## 6. 无网络测试

所有 AI 单元测试使用 `DeterministicFakeMemoryAssistant` 或注入的内存 `fetch`。
测试不会访问真实服务，不消耗额度，不读取真实 key，也不使用真实家庭素材。
兼容适配器的测试覆盖：独立能力、请求格式、密钥脱敏、错误正文隔离、取消、
超时、请求/响应大小、流式截断和响应 schema 校验。

## 7. 协议参考

适配器的通用请求形状参考官方 OpenAI 文档，但是否兼容仍由所选服务负责：

- [Text generation](https://developers.openai.com/api/docs/guides/text)
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Vector embeddings](https://developers.openai.com/api/docs/guides/embeddings)

隐私、同意、可见性与尚未完成的业务门禁见 [AI_PRIVACY.md](./AI_PRIVACY.md)。
