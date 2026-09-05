# 安全基线（Security）

> 本文档对应 PRD §16（权限与隐私）与 §17（安全底线）。当前状态：#002–#005、#017、RH-010 已实施并通过审计。

## 1. 无公开注册

- 不提供公开 signup 页面；普通访问者无法自行创建账号。
- 未登录用户只能访问：`/login`、`/setup`（受控，见下）、持有高熵 bearer token 的 `/invite/[token]`、`/api/auth/*` 认证端点、`/api/health`（只报数据库连通与版本，零数据泄露）与静态资源（图标/manifest/SW/离线页，不含任何家庭数据）。
- 其余全部路由位于 `(protected)` 路由组，由布局层会话守卫统一重定向到 `/login`；组内 `(app)` 子组再要求已完成家庭 onboarding（或恢复后的绑定流）。
- **注册闸门（RH-010 修复，High）**：better-auth 的 `/sign-up/email` 端点默认对外暴露——不加闸门时任何人可经 HTTP 直接创建账号（等于公开注册）。现以 `hooks.before` 守卫：所有带真实 `Request` 的调用（包括零用户实例）一律 403。无 Request 的内部调用仅有两条：零用户 `/setup`；或携带 AsyncLocalStorage capability 且数据库中仍有匹配、未过期、未撤销原子 claim 的邀请 provisioning。普通内部调用在已有用户后同样 403。回归测试：`tests/integration/signup-gate.test.ts`、`tests/integration/invitations.test.ts` 与 auth e2e。
- 后续成员只通过 **管理员邀请** 加入，而非开放注册。

### 邀请 token 与并发接受

- 管理员在 `/settings/invitations` 创建家庭作用域邀请，角色固定为 `admin | editor | contributor | viewer`，可选限定邮箱与未绑定账号的 Person；创建和撤销在服务端再次校验当前数据库中的 admin 角色。
- token 来自 `randomBytes(32)`（256 bit，base64url）；`family_invitation` **只存 SHA-256 hash**。原 token 只在创建成功响应中显示一次，不进入数据库、审计详情、导出或日志。
- 邀请有 `expiresAt`、`revokedAt`、`usedAt/usedBy`。接受前用单条带条件的 SQLite `UPDATE … RETURNING` 获取带过期时间的随机 claim nonce；因此 20 个并发请求最多一个能进入密码哈希。
- provisioning capability 同时绑定 invitation id、claim nonce、family、role、Person 与规范化邮箱；Better Auth hook 会从数据库重验 claim，且 Request-backed signup 即使碰巧处于 capability 上下文仍先被拒绝。
- Better Auth 生成 user id 后会在真正 INSERT 前把它写入邀请的 `provisioned_user_id`。provisional User 始终是**未绑定 family/Person 的 viewer**；即使进程在 scrypt / account / finalize 任一点崩溃，残留 session 也不能访问家庭或执行 onboarding 管理。过期 lease 重领时不换 receipt，而是删除旧的 unbound viewer 后复用同一 user primary key：旧进程迟到 INSERT 与新进程最多一个能通过 PK，且失败/撤销不会清掉这枚 durable fencing tombstone。正常完成时，目标 family/role/person 绑定、`usedAt`、receipt/claim 清理、临时 session 删除和接受审计在同一事务提交。邀请撤销会立即删当前 provisional；管理员邀请页用 Next `after()` 在响应后重扫 revoked/expired tombstone，安全清理更晚到达的孤儿。所有删除都要求准确 id 且仍是 unbound viewer，绝不按邮箱或删除已绑定/提权账号。
- token 位于 `/invite/<token>` 路径，应用响应带 `no-store`、`noindex` 与 `no-referrer`，但这些响应头**不能删除浏览器历史，也不能抹掉入口反向代理先写下的 access log**。生产代理必须在日志落盘前把 `/invite/*` 路径整体替换为 `/invite/[redacted]`，且日志格式不得使用仍含原请求行的 `$request`；部署清单给出 Nginx 示例。
- 当前 token 有 256 bit 熵，未知 token 的在线猜测不可行；原子 claim 也让一个有效邀请
  token 同时最多触发一次 scrypt。匿名讲述另有 5 次/小时/链接的 SQLite 原子持久化限流。
  邀请接受不设低阈值尝试计数：token 不可枚举、一次成功即消费、并发由 claim 原子化，
  而额外 IP 限流会给 NAT 家庭成员造成误伤。维护责任人为实例管理员：发现链接泄露即撤销，
  反向代理仍可按来源做通用 DoS 限制。

## 2. 首次初始化（/setup）威胁模型

**威胁**：实例刚部署、数据库为空时，“第一个访问 /setup 的人”抢占成为管理员。

**对策**（已实施）：

1. **环境变量令牌**：`/setup` 要求提交 `INITIAL_SETUP_TOKEN`（来自服务器环境变量）。
   - token 永不写入数据库、不出现在 URL（表单 POST / Server Action）、不写入日志；
   - 使用 SHA-256 等长化 + `crypto.timingSafeEqual` 比较，抗时序侧信道；
   - 未配置该环境变量时 `/setup` 直接禁用（只显示提示）。
2. **一次性闸门**：仅当数据库中不存在任何 User 时允许初始化；成功后（即使 token 仍保留）`/setup` 永久失效并重定向 `/login`。
3. **串行化**：初始化请求在进程内串行执行，避免并发窗口内创建多个管理员。
4. `/setup` 页面为 `force-dynamic`，初始化状态按请求数据库实时判定，不会被构建期缓存冻结。
5. **专项持久化限流**：10 次/15 分钟/实例，使用 SQLite 原子 UPSERT；key 只含
   `ftc:setup:` 与单向摘要，重启不会清零，也不依赖 Better Auth 的 HTTP 路由限流。

**残余风险与缓解**：

- 令牌暴力尝试：由上述专项限流约束；token 仍应有足够长度与随机性。
- 多进程首次初始化竞态：当前受支持拓扑是一个 `app` 进程 + 独立 worker，初始化在 app
  内串行；不要在同一未初始化数据库前并行启动多个 app 副本。若未来支持水平扩展，须先增加
  数据库级 bootstrap claim。Compose/Docker 的支持拓扑不存在该竞态。

## 3. 会话、Cookie 与原生 Bearer 策略

由 better-auth 管理（不自研协议）：

- session token 存于服务端 `session` 表；浏览器仅持有不透明 cookie。
- Cookie 属性：**HttpOnly**（JS 不可读）、**SameSite=Lax**、**生产环境（NODE_ENV=production）下 Secure**。
- 有效期 7 天，滚动续期（每天刷新一次 `expiresAt`）。
- 退出登录调用 `signOut`，服务端撤销 session 并清除 cookie。
- iOS/Android 原生端启用 Better Auth 官方 bearer transport；它只改变令牌传输方式，
  不建立第二套账号或长期 API key。Bearer 仍对应同一 `session` 表、同一 7 天滚动有效期，
  并在每个 API 入口实时重验账号停用、家庭绑定和角色权限。
- 原生端把 token 存在系统 Keychain/Keystore，绝不放 SQLite、文件、日志、GitHub Actions
  或 IPA/APK。Bearer 不是浏览器自动附带的 ambient credential，因此移动写入 API 不依赖
  Cookie CSRF；伪造/过期 token 返回 401，已停用/非法绑定 fail closed。
- `/api/mobile/v1/sync`、`home`、`inbox`、`inbox/:id/confirm`、`inbox/merge`、
  `memories`、`search` 与 `contributions` 只返回界面所需 DTO，
  不返回邮箱、哈希、storageKey、审计详情、metadataJson 或内部 AI 数据；响应统一
  `Cache-Control: private, no-store`，媒体继续走既有可见性鉴权端点。
- 移动收件箱/记忆/讲述写入从实时 Bearer session 推导 family、role、Person 与 guardian，
  请求体不接受 `familyId`。viewer 写入 403，跨家庭 ID 读写 404；Contribution 继续执行
  private/parents/family/child_later 和作者本人编辑策略。软删除事件在主页、详情、搜索和讲述
  查询中均按不存在处理，即使 FTS derivative 尚残留旧行也会用主表二次过滤。
- 口述史请求关联 `recipientPersonId` 时在写入前验证目标属于当前家庭；人物主页也先用
  `(familyId, personId)` 定位，再按当前查看者实时过滤讲述可见性。首页和家庭时区回顾仅查询
  confirmed 且未软删除事件，删除内容不会因旧索引、卡片聚合或日期匹配重新出现。

## 4. 密码存储

- better-auth 内置 **scrypt**（随机盐）哈希，格式 `salt:hash`，存于 `account.password`（providerId=`credential`）。
- 永远不保存明文；集成测试断言“库中口令不是明文”。
- 最短 10 位、最长 128 位。
- 登录失败统一提示“邮箱或密码不正确”，不区分“用户不存在/密码错误”。

## 5. 暴力破解与限流

- **持久化限流（v0.1.3）**：`rateLimit.storage: "database"` + `enabled: true`——计数落在 SQLite `rate_limit` 表（migration 0010），**重启不清零**，多实例共享同一数据库时天然一致。对 `/sign-in/*` 默认 10 秒 3 次（`customRules`，可用 `AUTH_SIGNIN_RATE_LIMIT_MAX` 放宽，仅测试环境使用）。行为在真实生产服务器上验证（roundtrip 测试：窗口内第 4 次登录 429、计数可从另一连接读到）。
- `/setup` 另有 10 次/15 分钟/实例、匿名讲述另有 5 次/小时/链接的应用级 SQLite
  原子限流；subject 先 SHA-256，setup token 与讲述 bearer token 从不入库。
- 注意：better-auth 的限流挂在 **HTTP 请求层**；服务端内部 `auth.api.*` 不经过它，
  所以公开 Server Action/API 必须像 setup/匿名讲述一样显式选择自己的策略。
- 可选纵深防御（Low）：登录失败人为延迟、验证码、入口代理通用连接/带宽限制。

## 6. CSRF 策略

三层防御：

1. Cookie `SameSite=Lax`：跨站 POST 不携带 cookie。
2. 认证端点（`/api/auth/*`）：better-auth 对非 GET 请求做 **Origin 校验**。
3. `/setup` 与业务表单走 **Next.js Server Action**（框架 Origin 校验 + 加密 action id）；
   自建状态变更 API（`/api/upload/*`、`/share`、`/respond/*/upload`）额外做
   `isSameOrigin` 显式校验：`Sec-Fetch-Site: cross-site` 直接拒绝，并按
   `Origin` 对比入口代理传来的首个 `X-Forwarded-Host`/`Host`。

## 7. 传输与部署

- 生产必须在 HTTPS 反向代理后运行（终止 TLS），容器内为 HTTP。
- 应用 CSP 不发送 `upgrade-insecure-requests`：TLS/HSTS 由真正持有证书的入口代理负责，避免把容器内 HTTP、自托管初始设置或健康检查错误升级到不存在的 HTTPS 端口。
- `docker-compose.yml` 强制要求 `AUTH_SECRET` 与 `BETTER_AUTH_URL`；任一缺失均拒绝启动。
- `BETTER_AUTH_URL` 必须是浏览器实际访问的唯一 origin；反向代理使用最终 HTTPS 地址。
  配错会让 Better Auth 安全拒绝登录，而不是猜测请求 Host。
- `AUTH_SECRET` 至少 32 字符随机值（`openssl rand -base64 32`）；泄露即轮换（会使现有 session 失效，需重新登录）。
- SQLite 数据库位于 `$DATA_DIR/db/capsule.sqlite`，随 Docker named volume 持久化。**文件系统权限由部署方负责**：`/data` 仅应对运行用户可读写（compose 不做 host bind mount 时由 Docker 卷隔离；若 bind mount，请自设属主 1001:nodejs 或更严格 umask）。数据库不含媒体本体（大媒体在文件系统）。

## 8. 媒体与文件（#005/#011/#017 已实施并审计）

- **上传校验**（`lib/assets/validation.ts`）：图片/音频/视频各自 MIME 白名单 + 内容魔数嗅探（声明与内容必须同族，防伪装扩展名）；大小上限图片 50MB / 音频 200MB / 视频 500MB；扩展名由 MIME 反推，**不信任上传文件名的扩展名**。
- **解析前大小闸门**：`/api/upload/image`、`/api/upload/media`、`/share` 与匿名讲述媒体
  在调用会物化请求体的 `formData()` 前强制有效、有限的 `Content-Length`；缺失、非法、
  chunked 或超限请求均拒绝，不能用传输编码绕过 50/200/500MB 上限。
- **新大文件路径**：Web、原生与家庭投递箱优先使用 `/api/uploads` 顺序续传。`PATCH` 仅接受
  原始二进制和准确 `Upload-Offset`/`Content-Length`，请求流直接追加到服务器生成的随机临时
  路径；不得由客户端指定路径，也不使用 multipart/完整 `arrayBuffer()`。磁盘长度与数据库
  offset 在锁内安全对账，complete 从磁盘流式哈希/嗅探/解析后原子发布；完成前临时文件无
  HTTP 读取入口，失败不会留下半成品 Asset。active 数、临时总空间、单文件和清理批次均有界。
- **document**：仅接受 PDF、TXT、Markdown、RTF、DOCX 白名单与对应魔数/结构；HTML/SVG
  不作为可执行预览，Office 文件只下载不执行，文本预览与索引有字符上限且不会把任意二进制
  强转文字。document 使用同一 SHA-256 去重、家庭隔离、媒体下载和引用清除守卫。
- **路径安全**：原 filename 永不进入磁盘路径，只清洗后作展示名；storageKey 白名单校验（正则 + 无 `..` + resolve 边界）。恶意文件名 `../../abc.jpg` 无法逃逸存储根目录（集成测试覆盖）。
- **媒体鉴权（无匿名 URL）**：`/data/**` 永不静态公开。唯一读取入口 `GET /api/media/[assetId]`：要求会话 + 家庭绑定 + Asset 属于该会话家庭，否则一律 404（不向跨家庭访问者暴露存在性）。响应带 `Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`、`Content-Disposition`（filename 剥离 `\r\n"`）。支持 Range（206/416）用于音频/视频回放。
- **导出端点**：`GET /api/export` 需会话 + 家庭绑定；导出前重验全部原件 SHA-256，不符返回 409。导出文件落在 `$DATA_DIR/exports/`。
- 重复原件（家庭内 SHA-256 一致）不静默复制，UI 明确提示并链接已有原件。

## 9. 家庭隔离（#017 专项审计）

- **原则**：`familyId` 是数据隔离边界；所有服务函数第一个参数即 familyId，查询一律带作用域条件。
- **媒体不存在永久公开路径**；`getAssetByIdUnchecked`（媒体端点用）取行后必须比对 `row.familyId === session.familyId`。
- **写入前校验**：所有 update 类操作（`updateAssetCapturedAt`、`updateContributionText`、`setFactStatus`、`discardInboxItem`、`seal/openCapsule` 等）先确认目标属于本家庭再写入。
  - **审计发现并修复（High）**：`updateContributionText` / `setFactStatus` 曾“先写入后校验”，跨家庭修改会实际生效——已改为先校验后写入（tests/integration/isolation.test.ts 回归覆盖，断言写入未发生）。
- **专项测试**（`tests/integration/isolation.test.ts`）：两个家庭全量数据互访——Asset / Inbox / MemoryEvent / Contribution / Fact / Capsule / Export 全部拒绝，且伪造 entry（B 的条目 + A 的资产）无法把 A 的资产挂进 B 的事件。
- 单家庭部署（P0）下 family 隔离主要防两类风险：未来多账号加入时的越权、以及任何注入 familyId 参数的 UI 路径错误。

## 10. XSS 与内容安全

- 全部页面为 React 服务端渲染，用户内容（标题/文本/文件名）默认转义。
- 媒体以 `<img>/<audio>/<video>` 或下载方式呈现，`Content-Type` 来自库内记录（上传时白名单化），加 `nosniff`。
- 导出 `timeline.md`：图片 alt 文本剥离 `]` 与换行，防止展示名破坏 Markdown 结构；标题/讲述为纯文本行。导出内容在 Markdown 查看器中的富渲染属于家庭内部自担内容（无跨用户注入面）。
- UI 响应使用逐请求随机 nonce 的 CSP；生产 `script-src` 不含 `unsafe-eval`，并限制 `object-src`、`base-uri`、`form-action` 与 `frame-ancestors`。API 使用 `default-src 'none'`。
- 全局响应同时发送 `nosniff`、`DENY` frame policy、`no-referrer`、Permissions Policy、COOP 与同源 CORP；Service Worker 另有严格脚本 CSP 和 `no-store`。
- TLS/HSTS 是部署入口职责；CSP 不强制升级请求，保证反向代理后的容器内 HTTP 与文档中的首次设置路径可用。

## 11. 删除与审计日志

- 事件、讲述与故事进入回收站时只写 `deletedAt/deletedBy`；普通列表、首页、回顾、搜索、
  导出与故事素材收集全部排除软删除行。恢复会清除删除标记。
- 硬清除必须由有权限的用户提交显式确认；素材只有在全引用守卫确认没有事件、收件箱、
  讲述、胶囊回复等引用时才可物理删除。跨家庭目标始终拒绝。
- 完整导出与恢复完成会写 family-scoped 审计条目；邀请、账号角色/禁用、guardian、
  `child_later` policy/unlock、AI consent 及 job cancel/retry 也写入不含 token、hash、
  正文、Provider response 或密码的 family-scoped 审计。关键权限变化与审计在同一
  事务提交；导出/恢复审计仍为 best-effort，不会把已经成功的恢复错误报告为失败。
- Trash move/restore/purge 均写 family-scoped 审计；收件箱 discard 仍是保留原件的状态变更。

## 12. 环境变量清单（安全相关）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `AUTH_SECRET` | 生产必填 | 会话签名密钥，≥32 随机字符，不入库不入 git |
| `INITIAL_SETUP_TOKEN` | 仅首次初始化 | 一次性 setup 令牌，初始化后建议移除 |
| `BETTER_AUTH_URL` | Docker/生产必填 | 浏览器实际访问的唯一 origin，用于回调与 origin 校验 |
| `DATA_DIR` | 否 | 数据根目录（Docker 内为 `/data`） |
| `AUTH_SIGNIN_RATE_LIMIT_MAX` | 否 | 登录限流覆盖（默认 3/10s；仅测试环境放宽） |
| `AI_PROVIDER` / `AI_BASE_URL` / capability models | 否 | 服务端 AI 配置；默认 disabled，远程 base URL 必须 HTTPS |
| `AI_API_KEY` | 启用外部 AI 时 | 仅服务端 secret 注入；不入库、不导出、不发客户端 |
| `AI_WORKER_POLL_MS` | 否 | worker 轮询间隔；不包含 secret |

## 13. 审计结论（2026-08-29，#017）

| 项 | 结论 |
| --- | --- |
| Auth / setup / session / CSRF | ✅ 见 §2–§6 |
| 上传 MIME / 大小 / 路径穿越 | ✅ 白名单 + 魔数 + storageKey 白名单（测试覆盖） |
| 媒体鉴权 / IDOR / 家庭边界 | ✅ 唯一鉴权入口 + 全服务 family 作用域 + 专项隔离测试 |
| **IDOR 写入（contribution/fact）** | ✅ **发现并修复**（先校验后写入），回归测试断言写入未发生 |
| 删除操作 | ✅ 回收站 + 显式 purge + 素材全引用守卫 + 审计 |
| 导出下载 | ✅ 鉴权 + 哈希强制校验 + 409 语义 |
| 胶囊可见性 | ✅ UI 锁定 + 导出完整（非加密，设计如此） |
| XSS / 文件服务头 / 缓存头 | ✅ React 转义 + nosniff + private,no-store |
| 限流 | ✅ SQLite 持久化，进程重启不清零 |
| SQLite 文件权限 | ⚠️ 交给部署方（文档见 §7） |
| CSP | ✅ 生产 nonce CSP，无 `unsafe-eval`，安全头 e2e 覆盖 |
| 审计日志 / 加密备份 | ✅ v1 敏感操作均有 family-scoped 审计；应用归档不内建加密，异地副本由部署方使用加密卷/工具保护（明确运维边界） |

## 14. 审计结论（2026-08-30，v0.1.1 RH-010）

| 项 | 结论 |
| --- | --- |
| **公开注册端点（/sign-up/email）** | 🔴→✅ **发现 High 级漏洞并修复**：所有真实 HTTP 注册请求（包括零用户实例）一律 403；首个管理员只能由 `/setup` 校验 `INITIAL_SETUP_TOKEN` 后通过无 Request 的内部 API 创建。初始化前后均有集成 + e2e 回归 |
| Restore ZIP path traversal | ✅ 条目名必须位于导出根内（禁 `..`/绝对路径/盘符/反斜杠），`unsafe_entry` 拒绝（tests/integration/restore.test.ts） |
| zip bomb | ✅ 三重限制：条目数 20 万 / 单文件 2GB / 总解压 25GB（`zip_bomb`/`file_too_large`/`too_many_entries`，限额可注入） |
| malformed manifest / JSON | ✅ 结构 + 引用完整性校验（`bad_manifest`/`bad_json`/`bad_refs`），重复 assetId 拒绝 |
| restore hash mismatch | ✅ 全部原件 SHA-256 复核，单个不符 → 整体拒绝且数据库保持为空 |
| 恢复目标校验 | ✅ 仅「无 Family」实例可恢复；merge restore 明确禁止（`target_not_empty`） |
| 跨家庭事件编辑（RH-003 新面） | ✅ `updateMemoryEvent` 先校验 event/family 归属；child/participant/cover 逐项校验（`bad_person`/`bad_cover`/`not_found`），tests/integration/memory-edit.test.ts |
| person participant IDOR | ✅ 同上（外家庭 Person 拒绝；参与者全集重写前逐个校验） |
| media / export / capsule IDOR | ✅ 沿用 #017 专项隔离测试（isolation.test.ts），随套件回归 |
| 事件编辑不触碰素材时间 | ✅ 编辑 occurredAt 与 Asset.capturedAt 完全解耦（集成测试断言不变） |
| 健康端点 | ✅ `/api/health` 仅报 db 连通与版本，无家庭数据 |

**当前结论**：账号/角色/可见性、Trash/purge、setup 专项限流均已完成回归。
归档加密由部署层承担；应用不会声称导出 ZIP 自带加密。

## 15. AI 同意、队列与 worker（migration 0016）

- 外部处理默认关闭；设置页披露 Provider、model、是否离开本机及每项 capability
  会发送的内容类型。只有当前未禁用 admin 可 enable/revoke consent。
- consent 与 family、capability、Provider/model、披露版本及递增版本号绑定，不随
  archive 导出/恢复；恢复实例必须重新同意。配置或 consent 漂移令旧 job fail closed。
- enqueue/claim/renew/finalize 都重验实时账号、角色、family、Contribution
  visibility、asset-root policy、source SHA/fingerprint 与运行时配置。admin 对
  private 内容没有旁路；automatic 处理只允许完全 family-visible 来源。
- queue 的 payload/output DB CHECK 固定为 `{}`；只保存 opaque id、fingerprint、
  provider/model、状态、attempt、lease 和安全错误 code。日志同样不得包含正文、
  transcript、媒体 URL/token、secret 或 Provider response。
- IMMEDIATE transaction、5 秒 busy timeout、幂等键、lease-generation fencing、
  heartbeat 与 terminal immutability 防止多进程重复提交和过期 worker 写回。
- production registry 已注册转录、图片理解、视频抽帧理解、事件 metadata 建议与
  收件箱建议 handler；每项都经过来源锁、结果审核、保留/重跑和 durable/derivative
  分类审计。配置缺失、未同意、来源或 Provider/model 漂移时 fail closed。

详细边界见 [AI_PRIVACY.md](./AI_PRIVACY.md) 和
[AI_PROVIDERS.md](./AI_PROVIDERS.md)。

## 16. v1 新增域的安全审计（M3–M8）

### 全文搜索（M4）
- `search_index` 是家庭隔离的 FTS5 derivative：MATCH 前强制 `family_id` 相等；
  Contribution 命中按可见性策略**后过滤**（private/parents/child_later 对无关读者
  不可见），隔离有集成测试覆盖。
- 只索引 user_confirmed 事实与用户修订转录；rejected/ai_suggested 永不入索引。

### 故事与 Quote Lock（M4）
- 生成输入白名单（确认事实 + family 讲述 + 修订转录）在服务层强制；
- 引文锁：quote 段落必须与来源当前文本逐字一致且不可编辑；叙述段禁止引号字符；
- 再生保护：已编辑/已发布故事永不被 regenerate 覆盖。

### 口述收集链接（M5）
- token 256-bit、只存 SHA-256、枚举不可行；过期/关闭在解析时强制；
- 访客页零家庭数据暴露（仅称呼与问题）；/respond/* 与 /invite/* 同样
  no-store + noindex + no-referrer（proxy.ts）；
- SQLite 原子持久化限流 5 条/小时/链接，20 路并发最多成功 5 条；
  文字与媒体提交都进收件箱审核，不直接发布。

### 家庭投递箱（1.1 M5）
- 通用 portal 是同一张 `contribution_request` 表的 `kind=portal`，继续使用 256-bit token
  与 SHA-256-only 存储；支持过期、暂停、撤销、换 token、提交次数/文件数/类型限制，旧
  token 在同一事务换新后立即失效。最多 20 个 active portal/家庭。
- `/contribute/*` 返回 `private, no-store`、`noindex, nofollow, noarchive` 与
  `no-referrer`。应用与审计不记录原 token；反向代理必须像 `/invite/*` 一样在写 access
  log 前把 `/contribute/<token>` 及子路径整体改写为 `/contribute/[redacted]`。
- 匿名查找 subject 和提交限流 subject 落库前再次 SHA-256；公开 DTO 只含家庭展示名、标题、
  说明与允许项，不含 family/person/user id。所有写请求要求同源，JSON 声明先做
  Content-Length 门禁；二进制只走顺序续传，不使用 multipart/`arrayBuffer()`。
- 每次访问形成 guest ImportSession bundle。文字和每个文件声明先持久化，失败项可针对同一
  captureId 重建 transfer；所有项目完成前 bundle 不能封口。完成项只创建一个 Asset 和一个
  InboxItem，匿名端没有媒体读取、搜索或枚举端点。
- 访客称呼只存在 bundle 并始终标记“访客填写，未经确认”；目标 Person 只是 Inbox 建议关系。
  Asset 的 `createdByUserId` 仍归因于 portal 创建者这一真实家庭账号，访客从不获得或冒充它。

### 书籍生成（M6）
- PDF/EPUB 媒体内嵌（DCTDecode / ZIP 条目），字节级测试确认无内部鉴权 URL；
- 下载路由走 `authorizeApiFamilyRequest`；仅 published 故事可成书。

### WebDAV 备份（M6）
- SSRF 边界：仅 https（loopback http 例外）；`redirect: "manual"` 不跟随；
  URL 内嵌凭据被拒绝；每次运行重新解析 env；
- 凭据零泄漏：错误信息、backup_run 历史、客户端输出经测试验证。
- ZIP 从磁盘流式 PUT，远端 GET 回读以流增量计算字节数与 SHA-256；不把上传或回读
  副本整块复制进 JS heap，所有成功/失败分支清理临时导出。

### PWA Share Target（M6）
- POST /share 要求同源 + 会话 + capture:create，与普通上传同一授权面。

### 原生日常领域 API（1.1 M6）
- `/api/mobile/v1/library/*` 只接受 Bearer session，从实时 User binding 推导 family/role/person；
  request body 出现 `familyId` 会被拒绝，目标资源的读写均先做 family scope，跨家庭统一 404。
- viewer 可读取最小 DTO，但所有写入在解析业务 body 前以 capability 拒绝；列表使用 cursor，响应
  一律 `private, no-store`。页面缓存只保存 DTO，不缓存口述史或投递箱明文 token。
- 未到期胶囊详情不下发 event/asset/contribution；Person 讲述继续走统一 Contribution visibility，
  admin 身份不会旁路 private/parents/child_later 策略。
- 创建回答/投递链接时 token 只在当次响应和页面内存状态出现；二维码完全本机渲染、不调用外部
  服务。投递箱换发在事务内替换 hash，旧 token 立即失效。

### 每周回顾与本地通知（1.1 M7）

- `/api/mobile/v1/review` 从实时 Bearer binding 推导 family/role，响应 `private, no-store`；跨家庭
  ReviewPeriod 统一 404，viewer 只读。重点只能关联同家庭、同周期、未删除且已确认的
  MemoryEvent。
- 无 AI 草稿先落地并逐段保存 `memory_event`/Fact/Contribution/Transcript 来源。AI 优化是单独
  manual job：必须有 `ai:review`、文本 capability 和现有逐能力 consent；只改未人工编辑的 draft，
  引文逐字复制并再次通过 Quote Lock，不能发布故事或确认事实。
- 通知权限与系统 notification identifier 只存在设备 SQLite，不进入家庭 archive。默认关闭，
  不自动请求；拒权不影响回顾。正文是固定通用文本，Android channel 设为 secret lock-screen
  visibility，胶囊标题、人物名、照片和家人原话均不进入 notification content。

### 回收站（M7）
- 软删除行在导出/搜索/素材收集中一律过滤（跨家庭隔离有测试）；
- 硬清除需显式确认并写审计；素材物理删除有全引用守卫。

### Portable archive / restore（1.1 M8）

- 1.1 的 ImportSession/Item/default participant、Contribution Request/Portal submission、
  ReviewPeriod/Event 和 document 原件进入 archive；导出原件 SHA-256 从文件流重算。
- 八份 1.1 关系 JSON 必须全部存在或全部缺失。部分图、悬空 Asset/Inbox/Person/Event/Story
  引用、跨家庭字段和非法状态在写任何原件前拒绝；事务提交前再次逐表复核行数。
- UploadSession、临时文件、认证 User/session、原始 guest token/hash 与设备通知状态不导出。
  恢复 request/portal 时强制 `closed`、`tokenHash=null`，所有登录归因映射到 restore operator，
  不能意外复活访客入口或旧凭据。

### CSP
- 页面：proxy.ts 按 request nonce + `strict-dynamic`（生产无 unsafe-eval）；
  API：`default-src 'none'`；sw.js 单独策略。

### 1.2 相册与日历

- Collection 列表/详情/计数/封面/选择均接受当前 FamilyContext；相册读写事务重验 live
  user/family/person/role/guardian/timezone。admin 不能绕过 private 讲述及其素材树权限。
- 写入 API 检查来源、编辑 capability、同源与有界 JSON；核心来源为 FK，批量保存全成或全败。
  相册清除/恢复不执行事件或素材删除，revision 冲突为 409。
- 日历与时间轴的媒体筛选和封面选择共用查询内原件/衍生物树权限；实际媒体下载继续实时鉴权。
  日历只统计 confirmed、未软删除事件；设备时区不参与服务器分桶。
- 相册模块备份保留编辑和墓碑；共享纯验证器在恢复文件写入前拒绝缺文件、跨家庭、悬空引用
  或位置/版本/字段非法。认证和设备授权不进入档案。

### 1.2 阅读衍生物

`/api/media/:assetId/derivations` 使用当前 FamilyContext；不接受 familyId，写请求沿用
同源/Bearer 校验。来源在请求、worker 开始、转换结束和最终提交时再次授权；Asset 输出指向
原件 FK。所有衍生物下载继续使用 `/api/media/:id` 的实时权限检查与 no-store，收紧讲述范围
后旧 URL 返回拒绝，不发匿名永久 URL。已经传到客户端的字节无法撤回。

转换仅对显式选择的原件执行，固定 ffmpeg demuxer/协议/参数；无任意 URL、用户脚本、HTML。
原生导出原件副本使用鉴权下载至临时 cache 文件并交给系统保存/分享，完成后清临时副本，
不删除本机原件/outbox。系统分享真实设备行为仍需要验收。

### 1.2 BookProject 阅读范围

所有书架、素材选择、保存、当前/历史预览均检查真实 FamilyContext；私人作品即使另一位
管理员也不能读取。家庭版额外排除 private/parents/child_later 讲述和未到期胶囊，不构造
管理员最大权限作为家庭读者。原件关联的衍生物也参与讲述和胶囊范围核对，避免旧关联旁路。
Published Story 的 Contribution/MemoryEvent/Transcript/Fact 及 FactSource 依赖需重新校验。
来源删除或失权时当前和历史块的正文、说明撤下，保存元数据不会用空值覆盖服务器原有文字。
完整档案仍按管理员备份权限导出全部既有范围，不把精选家庭读本等同于完整备份。
