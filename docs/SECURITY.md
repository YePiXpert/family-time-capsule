# 安全基线（Security）

> 本文档对应 PRD §16（权限与隐私）与 §17（安全底线）。当前状态：#002–#005、#017 已实施并通过审计。

## 1. 无公开注册

- 不提供公开 signup 页面；普通访问者无法自行创建账号。
- 未登录用户只能访问：`/login`、`/setup`（受控，见下）、`/api/auth/*` 认证端点与静态资源（图标/manifest/SW/离线页，不含任何家庭数据）。
- 其余全部路由位于 `(protected)` 路由组，由布局层会话守卫统一重定向到 `/login`；组内 `(app)` 子组再要求已完成家庭 onboarding。
- 未来成员加入通过 **管理员邀请**，而非开放注册。

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

- better-auth 内建 rate-limit 在生产默认开启（内存存储，按 IP+路径窗口限流），对 `/sign-in/*` 默认 10 秒 3 次；本项目通过 `customRules` 保留该默认并允许 `AUTH_SIGNIN_RATE_LIMIT_MAX` 环境变量放宽（仅 e2e 使用，见 e2e-server.mjs）。
- **已知限制（backlog）**：限流存储在进程内存——重启清零、多实例不共享。P1 计划：SQLite 持久化限流存储、登录失败延迟、可选验证码、`/setup` 同样限流。

## 6. CSRF 策略

三层防御：

1. Cookie `SameSite=Lax`：跨站 POST 不携带 cookie。
2. 认证端点（`/api/auth/*`）：better-auth 对非 GET 请求做 **Origin 校验**。
3. `/setup` 与业务表单走 **Next.js Server Action**（框架 Origin 校验 + 加密 action id）；自建 POST API（`/api/upload/*`）额外做 `isSameOrigin` 显式校验（`lib/security/origin.ts`）。

## 7. 传输与部署

- 生产必须在 HTTPS 反向代理后运行（终止 TLS），容器内为 HTTP。
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
- 未开启 CSP（backlog，见 §12）。

## 11. 删除与审计日志

- P0 **没有物理删除**：收件箱“废弃”是软状态（discarded），Asset 原件永不删除——不存在误删/越删的破坏面。
- 删除二次确认与导出/删除审计日志为 backlog（当前唯一高危操作“导出”已有明文入口与哈希校验）。

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
| 限流 | ⚠️ 内存存储（单实例可用），持久化在 backlog |
| SQLite 文件权限 | ⚠️ 交给部署方（文档见 §7） |
| CSP / 审计日志 / 加密备份 | 📋 backlog（Low，P1+） |
