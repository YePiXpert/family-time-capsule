# 桉桉成长记 · Build 73「说一段」实施计划（录音 → 转写成正文）

> 历史审查／设计记录。保留决策与技术依据；其中旧版本、操作命令和待办不代表当前状态。当前范围见 [PRODUCT](../../PRODUCT.md)，交付与待验事项见 [HANDOFF](../../HANDOFF.md)。

> 2026-09-21 起草（Build 72 交付当天）。**同日主人拍板「都做吧」：第七节五项按推荐项定，已实施——服务端 `8a27c6a`、手机端 `59ff497`（转写走 CPA 的 chat-style `input_audio`，`/audio/transcriptions` 在 CPA 上是 404，所以服务端用 ffmpeg 把 m4a 转成 16 kHz wav）；随 1.0.0 发版。**依据：PRODUCT.md 第八节次序 2（主人已拍板 72、73 都做、先 72 后 73）、第五节「记录员：说一段 → 文字。录音留着（声音才是宝贝），转写成正文，可改、可搜」、第九节第 2 条「转写先本机；需要时服务端可用小米 MiMo 一类的模型」；docs/AI-PROMPTS.md 第六节「说一段（转写）不是提示词」。
> 家史（第八节次序 5）主人 2026-09-21 拍板不做；本计划不含长辈访谈，长辈口述就是普通记录 + 落款 + 说一段。

## 一、Context

- 现状：录音这一段已经在（`mobile/src/local/editorHooks.ts:132-226`：expo-audio `AudioRecorder` → `finishAudio` → `preserveMedia(uri, "录音.m4a", "audio")`；`Draft.recordingFile` 记未完成的录音；`MediaKind` 含 `audio`；`Media.tsx:38` 播放；阅读页「听录音」；归档把 audio 存成「录音／m4a」；信也能附录音）。**没有任何识别／转写代码**：`rg -n 'transcri|Speech|speech|ASR|MiMo' mobile/src server/src mobile/modules` 无命中，`node_modules` 没有语音包，`app.json` 没有 `NSSpeechRecognitionUsageDescription`。
- 目标：编辑页录完一段，几秒后正文框里出现这段话的文字初稿，家人改两笔就能保存；录音仍留在这段时光里。iPhone 全部在本机完成；国内安卓机多半没有本机识别，逐段征得同意后把这一段录音经主人的服务送给转写模型，服务端不留声音。
- 不做：边说边出字（流式）、自动分说话人、AI 润色转写、给信的正文转写（信可附录音但不转写——要做再说）、方言专项。
- 三问：她会想听也会想读 ✓；录音是 m4a、正文是 Markdown，开放归档与纸书已经带 ✓；一只手按住说、松手就有字 ✓。
- 纪律不变：只在 main 小提交直推；每次推送前 mobile 三件套（`TMPDIR=/var/tmp/anan-tests npm test`、`typecheck`、`lint`）+ server 两件套 + `python3 mobile/scripts/verify-local-boundary.py` + `python3 -m unittest discover -s mobile/scripts -p 'test_*.py'` 全绿；构建号只在收尾提交里改；UI 只用 `mobile/src/local/ui.tsx` 的基元并同步 DESIGN.md。

## 二、开工时要确认的环境事实

- 生产服务端 = `473339b`（Build 72 家庭空间）；main 上的服务端审查修复（A-1/2/3/11/15/18）**尚未部署**——提交 1 部署时一并带上，部署前 `cp -a /opt/anan-ai/data /opt/anan-ai/data.bak-<时间>`，staging 3141 跑 `verify-service.py` 全绿再切。
- 手机端 Expo SDK `~57.0.24`、RN `0.86.3`（`mobile/package.json`）；自写 Expo Module 的模板是 `mobile/modules/share-intake/`（`expo-module.config.json`、Swift `FamilyShareIntakeModule.swift`、Kotlin、TS 桥 `src/index.ts`、配置插件 `plugins/with-native-share-intake`）。
- 宪法（`mobile/scripts/local_boundary.py`）：`fetch`／`XMLHttpRequest` 只允许在 `src/ai/client.ts` 与 `src/sync/transport.ts`；`src/local` 可以 import `../ai`（`Editor.tsx:1` 就这么做），`src/ai` 不得 import 本机页面组件；`package.json` 不得带 `expo-network`（分不出 Wi‑Fi）。原生识别模块不含网络调用，不触碰规则 1。
- 现有 AI 同意是一次性的全局 yes（`mobile/src/ai/session.ts:39-42`），转写要逐段同意，不能沿用。
- 平台事实（落地前在真机核，别当已验证）：iOS `SFSpeechRecognizer(locale: zh-CN)` 支持对文件识别（`SFSpeechURLRecognitionRequest`），`requiresOnDeviceRecognition = true` 时不出手机、且不受服务端识别的一分钟限制，但设备要有中文离线包（系统「听写」下载过）——运行时查 `supportsOnDeviceRecognition`，没有就当不可用；Android `SpeechRecognizer` 的本机识别（`isOnDeviceRecognitionAvailable`，API 31+）与文件输入（`EXTRA_AUDIO_SOURCE`，API 33+）在国内机型上多半不可用，不可用即回退服务端；CPA 能否转发音频（OpenAI 兼容 `audio/transcriptions`）未核实。

## 三、设计定稿（按推荐项写；第七节改了这里跟着改）

1. **转写产物只是正文文字。** 不加新实体、不加「这段文字来自哪段录音」的字段；录音仍是 `mediaIds` 里的 audio 素材。所以 `merge.ts`、归档、纸书一行不改（原则 6 自动满足）。
2. **本机识别模块** `mobile/modules/speech-recognition/`（路线 A，自写 Expo Module）：TS 接口 `availability(): Promise<"on-device" | "unavailable">`、`transcribeFile(uri, {locale:"zh-CN", signal}) → Promise<{text: string}>`、错误码 `UNAVAILABLE`／`DENIED`／`CANCELED`／`FAILED`；iOS 用 `SFSpeechURLRecognitionRequest` + `requiresOnDeviceRecognition`，取最终 `bestTranscription.formattedString`；Android 先查 `isOnDeviceRecognitionAvailable` 与 API 33 文件输入，否则 `UNAVAILABLE`（首版可以直接在 Android 返回 `UNAVAILABLE`，服务端回退兜底——第七节第 1 项）。`app.json` 加 `NSSpeechRecognitionUsageDescription`（「把你说的话转成文字，只在这台手机上完成。」）。模块**永不**隐式走云端（`requiresOnDeviceRecognition` 是硬性的）。
3. **编排** `mobile/src/local/transcribe.ts`（纯选路与状态，不联网）：录音结束后 → 本机可用就本机转写 → 不可用且已登录 → 问一次「要不要经主人的服务转成文字」（逐段同意，可勾「这台手机以后都同意」，记在设备本地 `settings.transcribeConsent`，不同步）→ 同意就交给 `src/ai/transcribe.ts` → 都不行就只留录音，正文不动，一行辅助色说明「这台手机没有中文本机识别；登录家人账号后可以经服务转文字。」
4. **服务端回退** `POST /api/v1/ai/transcribe`：请求体 `audio/mp4` 二进制（`Content-Length` 预检 ≤ 5 MiB，照 `PUT /backup/objects/:id` 的 passthrough 解析器与长度计数），可选头 `X-Audio-Seconds`（≤ 180）；响应 `{text}`；错误码复用 `AUTH_REQUIRED`／`RATE_LIMIT`／`UPSTREAM_UNAVAILABLE`／`INVALID_RESULT`，新增 `AUDIO_TOO_LONG`（413）。`provider.ts` 新增 `transcribeProvider(baseUrl, keyFile)`：上游按第七节第 2 项（推荐先探 CPA 的 `audio/transcriptions`；不行就直连 MiMo，密钥文件另配 `TRANSCRIBE_KEY_FILE`），提示只一句「中文口语，保留昵称与口头语，标点按停顿」；**不落盘、不写日志、结果不进缓存**；额度：一次转写 = 一次写作（`store.reserve(…, photos=0, writes=1)`），不加列（第七节第 3 项）；上游超时 100 s（与 `provider.ts:20` 同）。手机端 `src/ai/client.ts` 新增 `upload<T>(path, bytes: Uint8Array, contentType, signal)`（同一套 token／超时／错误映射，二进制体不 JSON.stringify），`src/ai/transcribe.ts` 只做读文件 + 调 `upload` + 校验 `{text}` 形状。
5. **编辑页**（`Editor.tsx`、`editorHooks.ts`）：`finishAudio` 成功入库后触发转写；进行中「录音」按钮位置显示「正在转成文字…」与文字级「停止」（停止只取消转写，录音已保存）；结果**追加**到 `draft.content.text`（正文非空时空一行接在后面，不覆盖；等待期间家人继续打字的内容原样保留，照 `NoteCard.tsx:71-83` 的「快照 + 晚到结果不盖字」思路）；失败或不可用一行辅助色说明，录音照样在素材列表里。分组模式（`photoEvents`）下转写进顶部正文框，与现有落款规则一致。DESIGN.md「编辑」条补一句；「今天的小问题」卡在正文非空后本来就收起，不用改。
6. **信**不转写（`LetterEditor` 的录音流程不动）。
7. **旧版兼容**：没有任何数据格式改动；Build 72 手机与 73 手机同步互不影响。服务端新端点对旧 App 无关。

## 四、提交清单（9 个，全部在 main；服务端 1–2 先行）

**提交 1 · 服务端转写端点**：`server/src/contracts.ts` 新增 `transcribeResultSchema`（`{text: string ≤ 5000}`）；`provider.ts` 新增 `transcribeProvider` 与 `Transcriber` 类型；`app.ts` 新增 `POST /api/v1/ai/transcribe`（鉴权、`Content-Length` 预检、时长头、额度 reserve／finish、错误映射、不落盘）；`index.ts` 装配（环境变量 `TRANSCRIBE_BASE_URL`／`TRANSCRIBE_KEY_FILE`，缺省沿用 CPA）；`server/tests/app.test.ts` 假上游：成功、401、413（字节与时长各一）、上游 502 不计额度、写作额度用尽 429、结果形状坏 502、临时文件为空。顺手：`app.ts:16` 惰性 `BackupStore` 改必填（测试自己传）；`store.ts` claims 每设备行数上限（PROJECT-AUDIT 残留 ②）。
**提交 2 · 自检与部署**：`server/scripts/verify-service.py` 加转写段（一段合成的 2 秒静音 m4a，只验状态码与形状；`--skip-transcribe` 可跳过）；`deploy/README.md` 补上游配置与「服务端不留声音」的契约；`deploy/compose.yaml` 加两个可选环境变量。staging 3141 全绿 → `cp -a data` → 切生产（连同未部署的审查修复）→ `/healthz` 对 SHA → HANDOFF 第一节记 SHA。**部署要主人放行。**

**提交 3 · 原生模块（iOS）**：`mobile/modules/speech-recognition/`（`expo-module.config.json`、`package.json`、`ios/*.swift`、`ios/*.podspec`、`src/index.ts`），配置插件 `mobile/plugins/with-speech-recognition`（写 `NSSpeechRecognitionUsageDescription`）；`app.json` 注册插件；`tests/helpers/speech-recognition-fake.ts` 假件（可编程 availability／结果／失败／延迟）。踩坑：Swift 侧用 `SFSpeechURLRecognitionRequest`，`requiresOnDeviceRecognition = true`，`shouldReportPartialResults = false`；授权状态 `notDetermined` 时先 `requestAuthorization`；被拒回 `DENIED`。
**提交 4 · 原生模块（Android）**：`android/` 侧实现 `availability`（API 31+ `isOnDeviceRecognitionAvailable`，低版本一律 `unavailable`）与文件识别（API 33+ `EXTRA_AUDIO_SOURCE`；不满足回 `UNAVAILABLE`）。**先用独立 kotlinc 对 android-36 的 android.jar 编一份用法一致的 snippet**（HANDOFF 踩坑第 1 条）。若第七节第 4 项拍板「73 只做 iOS 本机」，本提交推迟到 73b，Android 侧固定回 `UNAVAILABLE`。
**提交 5 · 编排与上传**：`mobile/src/local/transcribe.ts`（选路状态机：`on-device` → `server-consent` → `server` → `none`，纯函数可测）；`mobile/src/ai/client.ts` 新增 `upload()`；`mobile/src/ai/transcribe.ts`；`model.ts` `settings.transcribeConsent?: boolean`（设备本地根字段，`validRoot` 接受，不进同步——`merge.ts` 的 `settings` 本来就不共享）。测试：选路各分支、同意门控、上传错误映射、`CANCELED`。
**提交 6 · 编辑页**：`Editor.tsx`／`editorHooks.ts`：录音结束触发、进度与停止、追加语义（空正文／非空正文／等待期间又打了字）、失败说明、同意弹窗（`Alert` 二选一 + 「以后都同意」）；DESIGN.md「编辑」条；`tests/editor-transcribe.test.ts`（手写 hook 夹具驱动真函数，照 `note-card.test.ts` 的做法）。
**提交 7 · 冒烟**：`smoke-android.py` 与 iOS 回归只断言编辑页有「说一段」入口与降级说明（CI 没麦克风、没离线包）；`local_fixture.py` 不用改。
**提交 8 · 文档**：README「使用」加一条、「AI 使用」加转写段（送什么、不留什么、额度）；`docs/AI-PROMPTS.md` 第六节改成落地后的描述；CHANGELOG「Build 73 — 说一段」。
**提交 9 · 收尾出包**：`mobile/app.json` 73（定点改）；`mobile-build.yml` 顺手补 server typecheck 与 GitHub Release 作业（`contents: write` 只给该作业）；派发 `mobile-build.yml`（完整 40 位 SHA）→ 校验和记 HANDOFF 第一节。

## 五、验收

1. iPhone（有中文离线包）：飞行模式下录 30 秒 → 几秒后正文里出现文字、录音在素材列表、可播放；关掉离线包后走同意弹窗（未登录则只留录音 + 说明）。
2. 安卓（国内机）：录完 → 同意弹窗 → 经服务转文字；拒绝 → 只留录音；未登录 → 说明一句；地铁里断网 → 录音保存、正文不动、说明「现在连不上服务」。
3. 等待期间继续打字，转写到达后自己打的字一个不少、转写接在后面；「停止」后晚到的结果不进正文。
4. 服务端：staging `verify-service.py` 全绿；`docker exec` 看 `/data` 与容器 `/tmp` 没有任何音频残留；额度页写作次数 +1；上游 502 不计额度。
5. 备份往返、开放归档（录音文件 + 正文）、纸书（正文进当月章）与 Build 72 一致，无格式改动；两台手机同步转写后的记录不出冲突卡。
6. 双端冒烟全绿；mobile 测试 ≥ 597 + 新增；server 测试 ≥ 58 + 新增。

## 六、风险与对策

- **iPhone 没装中文离线包**：识别不可用 → 走同意 + 服务端；说明文案教用户去「设置 → 通用 → 键盘 → 听写语言」下载（文案待真机核对路径）。
- **CPA 不转发音频**：直连 MiMo（另一把密钥文件，只在服务端）；provider 抽象已隔离，改配置不改 App。
- **长录音**：3 分钟／5 MiB 上限，超过只留录音并说明「太长了，转文字最多 3 分钟」；本机识别不受此限。
- **转写质量差**：正文只是初稿，家人必改；不做润色（原则 5）。
- **额度被转写吃掉**：一次 = 一次写作，每人每天 20 次够用；主人管理页可调。

## 七、待主人拍板（开工前）—— 2026-09-21 已按推荐项拍板（1 A 自写模块；2 经 CPA，但形状是 chat-style `input_audio` wav；3 一次转写 = 一次写作；4 一起交付；5 录完自动追加）

1. 识别路线：**A 自写 Expo Module（推荐，模板现成、不引入未核实依赖）** / B 社区包（先核包名、版本、SDK 57 兼容、是否强制 `requiresOnDeviceRecognition`）。
2. 安卓回退上游：**先探 CPA 的 `audio/transcriptions`（推荐）**，不通就直连 MiMo（服务端另配密钥）。
3. 额度：**一次转写 = 一次写作（推荐，不加列）** / 新列按分钟计。
4. 交付拆分：**73 = iOS 本机 + 安卓服务端回退一起（推荐）** / 73（iOS 本机）+ 73b（安卓）。
5. 转写进正文：**录完自动追加（推荐，凌晨三点少一步）** / 先预览再「采用」。
