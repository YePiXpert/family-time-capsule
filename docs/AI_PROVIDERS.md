# AI Provider 配置与适配器

> 当前状态：**基础设施已实现，业务功能尚未启用**。`lib/ai/` 已提供
> provider-neutral 接口、关闭实现、离线 Fake 和 OpenAI-compatible 传输层；
> 当前没有 Route Handler、页面、后台任务或数据库流程把家庭素材交给 AI。
> 仅配置环境变量不会自动上传或处理任何资料。

## 1. 架构边界

业务代码只依赖 `MemoryAssistant`，不依赖 OpenAI、Kimi、GLM、Grok、
Anthropic 或任何特定 SDK：

```text
未来的授权应用服务 / SQLite worker
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
`model`，供未来同意界面、来源记录和审计使用。接口不接收数据库实体，也不
能写入 Fact；AI 输出是否形成可审核建议，由后续业务服务决定。

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

## 4. 输入与响应限制

除可调的 HTTP 请求/响应上限外，协议层还有固定的逐能力输入上限：

- 文本：最多 64 条消息、每条最多 100,000 字符、总计最多 1 MiB UTF-8；
- 图片：只接受 JPEG/PNG/WebP/GIF，原始字节最多 20 MiB；
- 音频：只接受列明的 FLAC/M4A/MP4/MP3/OGG/WAV/WebM，最多 25 MiB；
- 向量：一次 1–256 条，每条最多 20,000 字符，总计最多 1 MiB UTF-8；
- 兼容层返回的向量必须数量一致、索引唯一、维数一致且全部为有限数值。

这些是应用安全上限，不代表某个供应商一定接受同样大小。长音频分片、重试、
持久化 job 和断点恢复属于后续 worker 里程碑，当前尚未启用。

## 5. 无网络测试

所有 AI 单元测试使用 `DeterministicFakeMemoryAssistant` 或注入的内存 `fetch`。
测试不会访问真实服务，不消耗额度，不读取真实 key，也不使用真实家庭素材。
兼容适配器的测试覆盖：独立能力、请求格式、密钥脱敏、错误正文隔离、取消、
超时、请求/响应大小、流式截断和响应 schema 校验。

## 6. 协议参考

适配器的通用请求形状参考官方 OpenAI 文档，但是否兼容仍由所选服务负责：

- [Text generation](https://developers.openai.com/api/docs/guides/text)
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Vector embeddings](https://developers.openai.com/api/docs/guides/embeddings)

隐私、同意与尚未完成的启用门禁见 [AI_PRIVACY.md](./AI_PRIVACY.md)。
