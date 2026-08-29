# 安全基线（Security）

> 本文档对应 PRD §16（权限与隐私）与 §17（安全底线），随相关 Issue 演进。当前状态：#002 已实施。

## 1. 无公开注册

- 不提供公开 signup 页面；普通访问者无法自行创建账号。
- 未登录用户只能访问：`/login`、`/setup`（受控，见下）与 `/api/auth/*` 认证端点。
- 其余全部路由位于 `(protected)` 路由组，由布局层会话守卫统一重定向到 `/login`。
- 未来成员加入通过 **管理员邀请**（#003 之后的 Issue），而非开放注册。

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

- 令牌暴力尝试：目前依赖 better-auth 内建 rate-limit（见 §5 的后续计划）；token 应有足够长度与随机性。
- 多进程部署的并发竞态：单家庭自托管为单进程场景；若未来多实例，需要数据库级唯一约束兜底。

## 3. 会话与 Cookie 策略

由 better-auth 管理（不自研协议）：

- session token 存于服务端 `session` 表；浏览器仅持有不透明 cookie。
- Cookie 属性：**HttpOnly**（JS 不可读）、**SameSite=Lax**、**生产环境（NODE_ENV=production）下 Secure**。
- 有效期 7 天，滚动续期（每天刷新一次 `expiresAt`）。
- 退出登录调用 `signOut`，服务端撤销 session 并清除 cookie。

## 4. 密码存储

- better-auth 内置 **scrypt**（随机盐）哈希，格式 `salt:hash`，存于 `account.password`（providerId=`credential`）。
- 永远不保存明文；本仓库有集成测试断言“库中口令不是明文”。
- 最短 10 位、最长 128 位（`minPasswordLength`/`maxPasswordLength`）。
- 登录失败统一提示“邮箱或密码不正确”，不区分“用户不存在/密码错误”。

## 5. 暴力破解与限流

- 现状：better-auth 内建 rate-limit 在生产默认开启（内存存储，按 IP+路径窗口限流），对 `/sign-in/*` 默认 10 秒 3 次；本项目通过 `customRules` 保留该默认并允许 `AUTH_SIGNIN_RATE_LIMIT_MAX` 环境变量放宽（e2e 使用）。
- 后续计划（#017 前完成）：持久化限流存储（SQLite/Redis）、登录失败延迟、可选验证码；对 `/setup` 增加同样的限流规则。

## 6. CSRF 策略

- 认证端点（`/api/auth/*`）：better-auth 对非 GET 请求做 **Origin 校验**（对照 baseURL / trustedOrigins），不匹配即拒绝。
- `/setup` 提交走 **Next.js Server Action**：框架自带 Origin 校验与加密 action id。
- Cookie `SameSite=Lax` 提供第三层防护（跨站 POST 不携带 cookie）。

## 7. 传输与部署

- 生产必须在 HTTPS 反向代理后运行（终止 TLS），容器内为 HTTP。
- `docker-compose.yml` 强制要求 `AUTH_SECRET`；缺失则拒绝启动。
- `AUTH_SECRET` 至少 32 字符随机值（`openssl rand -base64 32`）；泄露即轮换（会使现有 session 失效，需重新登录）。

## 8. 媒体与文件（#005 已实施）

- **上传校验**（`lib/assets/validation.ts`）：MIME 白名单（jpeg/png/webp/gif/heic/heif/avif）+ 内容魔数嗅探（声明与内容必须同族，防伪装扩展名）；单文件 50MB 上限；扩展名由 MIME 反推，**不信任上传文件名的扩展名**。
- **路径安全**：原 filename 永不进入磁盘路径，只清洗后作展示名；storageKey 白名单校验（见 DECISIONS D-008）。恶意文件名 `../../abc.jpg` 无法逃逸存储根目录（有测试）。
- **媒体鉴权**：`/data/**` 永不静态公开。唯一读取入口 `GET /api/media/[assetId]`：要求会话 + Asset 属于该会话家庭，否则一律 404（不向跨家庭访问者暴露存在性）。响应带 `Cache-Control: private, no-store` 与 `X-Content-Type-Options: nosniff`。
- **上传端点**：`POST /api/upload/image` 要求会话 + 家庭绑定 + 同源 Origin（自建 POST 路由的 CSRF 纵深防御，Cookie SameSite=Lax 之外的第二层）。
- 重复原件（家庭内 SHA-256 一致）不静默复制，UI 明确提示并链接已有原件。
- 删除操作二次确认；导出/删除操作写审计记录（#014/#017 计划）。

## 9. 环境变量清单（安全相关）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `AUTH_SECRET` | 生产必填 | 会话签名密钥，≥32 随机字符，不入库不入 git |
| `INITIAL_SETUP_TOKEN` | 仅首次初始化 | 一次性 setup 令牌，初始化后建议移除 |
| `BETTER_AUTH_URL` | 反代部署建议 | 对外地址，用于 origin 校验 |
| `DATA_DIR` | 否 | 数据根目录（Docker 内为 `/data`） |
