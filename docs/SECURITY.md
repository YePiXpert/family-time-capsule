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
- 当前 token 有 256 bit 熵，未知 token 的在线猜测不可行；原子 claim 也让一个有效 token 同时最多触发一次 scrypt。公共邀请/贡献链接的统一持久化速率限制仍是 v1 安全 backlog，不能把现有 Better Auth 登录限流误认为已覆盖邀请 Server Action。

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

**残余风险与缓解**：

- 令牌暴力尝试：依赖 §5 限流；token 应有足够长度与随机性。
- 多进程部署的并发竞态：单家庭自托管为单进程场景；若未来多实例，需要数据库级唯一约束兜底。

## 3. 会话与 Cookie 策略

由 better-auth 管理（不自研协议）：

- session token 存于服务端 `session` 表；浏览器仅持有不透明 cookie。
- Cookie 属性：**HttpOnly**（JS 不可读）、**SameSite=Lax**、**生产环境（NODE_ENV=production）下 Secure**。
- 有效期 7 天，滚动续期（每天刷新一次 `expiresAt`）。
- 退出登录调用 `signOut`，服务端撤销 session 并清除 cookie。

## 4. 密码存储

- better-auth 内置 **scrypt**（随机盐）哈希，格式 `salt:hash`，存于 `account.password`（providerId=`credential`）。
- 永远不保存明文；集成测试断言“库中口令不是明文”。
- 最短 10 位、最长 128 位。
- 登录失败统一提示“邮箱或密码不正确”，不区分“用户不存在/密码错误”。

## 5. 暴力破解与限流

- **持久化限流（v0.1.3）**：`rateLimit.storage: "database"` + `enabled: true`——计数落在 SQLite `rate_limit` 表（migration 0010），**重启不清零**，多实例共享同一数据库时天然一致。对 `/sign-in/*` 默认 10 秒 3 次（`customRules`，可用 `AUTH_SIGNIN_RATE_LIMIT_MAX` 放宽，仅测试环境使用）。行为在真实生产服务器上验证（roundtrip 测试：窗口内第 4 次登录 429、计数可从另一连接读到）。
- 注意：better-auth 的限流挂在 **HTTP 请求层**；服务端内部 `auth.api.*` 调用（如 /setup 的 performSetup）不经过限流，属预期。
- 剩余 backlog（Low）：登录失败人为延迟、可选验证码、`/setup` 专项限流规则。

## 6. CSRF 策略

三层防御：

1. Cookie `SameSite=Lax`：跨站 POST 不携带 cookie。
2. 认证端点（`/api/auth/*`）：better-auth 对非 GET 请求做 **Origin 校验**。
3. `/setup` 与业务表单走 **Next.js Server Action**（框架 Origin 校验 + 加密 action id）；自建 POST API（`/api/upload/*`）额外做 `isSameOrigin` 显式校验（`lib/security/origin.ts`）。

## 7. 传输与部署

- 生产必须在 HTTPS 反向代理后运行（终止 TLS），容器内为 HTTP。
- 应用 CSP 不发送 `upgrade-insecure-requests`：TLS/HSTS 由真正持有证书的入口代理负责，避免把容器内 HTTP、自托管初始设置或健康检查错误升级到不存在的 HTTPS 端口。
- `docker-compose.yml` 强制要求 `AUTH_SECRET`；缺失则拒绝启动。
- `AUTH_SECRET` 至少 32 字符随机值（`openssl rand -base64 32`）；泄露即轮换（会使现有 session 失效，需重新登录）。
- SQLite 数据库位于 `$DATA_DIR/db/capsule.sqlite`，随 Docker named volume 持久化。**文件系统权限由部署方负责**：`/data` 仅应对运行用户可读写（compose 不做 host bind mount 时由 Docker 卷隔离；若 bind mount，请自设属主 1001:nodejs 或更严格 umask）。数据库不含媒体本体（大媒体在文件系统）。

## 8. 媒体与文件（#005/#011/#017 已实施并审计）

- **上传校验**（`lib/assets/validation.ts`）：图片/音频/视频各自 MIME 白名单 + 内容魔数嗅探（声明与内容必须同族，防伪装扩展名）；大小上限图片 50MB / 音频 200MB / 视频 500MB；扩展名由 MIME 反推，**不信任上传文件名的扩展名**。
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

- P0 **没有物理删除**：收件箱“废弃”是软状态（discarded），Asset 原件永不删除——不存在误删/越删的破坏面。
- 完整导出与恢复完成会写 family-scoped 审计条目；邀请创建、撤销与使用也写入不含 token、hash、密码的 family-scoped 审计。邀请审计与邀请状态在同一事务提交；导出/恢复审计仍为 best-effort，不会把已经成功的恢复错误报告为失败。
- Trash/显式 purge、删除二次确认及其扩展审计仍属于 v1 backlog。

## 12. 环境变量清单（安全相关）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `AUTH_SECRET` | 生产必填 | 会话签名密钥，≥32 随机字符，不入库不入 git |
| `INITIAL_SETUP_TOKEN` | 仅首次初始化 | 一次性 setup 令牌，初始化后建议移除 |
| `BETTER_AUTH_URL` | 反代部署建议 | 对外地址，用于 origin 校验 |
| `DATA_DIR` | 否 | 数据根目录（Docker 内为 `/data`） |
| `AUTH_SIGNIN_RATE_LIMIT_MAX` | 否 | 登录限流覆盖（默认 3/10s；仅测试环境放宽） |

## 13. 审计结论（2026-08-29，#017）

| 项 | 结论 |
| --- | --- |
| Auth / setup / session / CSRF | ✅ 见 §2–§6 |
| 上传 MIME / 大小 / 路径穿越 | ✅ 白名单 + 魔数 + storageKey 白名单（测试覆盖） |
| 媒体鉴权 / IDOR / 家庭边界 | ✅ 唯一鉴权入口 + 全服务 family 作用域 + 专项隔离测试 |
| **IDOR 写入（contribution/fact）** | ✅ **发现并修复**（先校验后写入），回归测试断言写入未发生 |
| 删除操作 | ✅ P0 无物理删除 |
| 导出下载 | ✅ 鉴权 + 哈希强制校验 + 409 语义 |
| 胶囊可见性 | ✅ UI 锁定 + 导出完整（非加密，设计如此） |
| XSS / 文件服务头 / 缓存头 | ✅ React 转义 + nosniff + private,no-store |
| 限流 | ✅ SQLite 持久化，进程重启不清零 |
| SQLite 文件权限 | ⚠️ 交给部署方（文档见 §7） |
| CSP | ✅ 生产 nonce CSP，无 `unsafe-eval`，安全头 e2e 覆盖 |
| 审计日志 / 加密备份 | ⚠️ 导出、恢复与邀请生命周期已审计；其余 v1 敏感操作扩展与备份加密仍待完成 |

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

**仍待 v1 完成**：账号禁用/角色变更与可见性专项审计、Trash/purge 审计、备份加密、setup 专项滥用防护。
