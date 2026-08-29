# 决策记录（ADR）

> 规则（PRD §25）：如果 PRD 与现有代码冲突，先在这里写清楚，不自行扩大范围。

## D-001 产品层面最重要的十个决定（PRD §31）

1. **不要求通过本 App 产生媒体。**
2. **后续上传与直接记录同等重要。**
3. **capturedAt 和 importedAt 必须分离。**
4. **原件不可覆盖。**
5. **MVP 不依赖 AI。**
6. **MemoryEvent 是核心，Asset 是证据。**
7. **同一事件允许多个家人的独立视角。**
8. **完整导出是 MVP 功能。**
9. **第一阶段只服务一个家庭，不做 SaaS。**
10. **产品寿命按 18 年以上设计，而不是按“宝宝 App”设计。**

## D-002（Issue #001）技术选型与脚手架

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：采用 `create-next-app` 生成的 Next.js 16（App Router）+ TypeScript + Tailwind CSS v4 单体全栈作为起点；测试用 Vitest（单元）+ Playwright（端到端，生产构建 + 端口 3100）；Docker 镜像基于 `node:24-alpine` 多阶段构建 + Next standalone 产物，`ffmpeg` 随镜像安装（增强能力，非核心硬依赖）；CI（GitHub Actions）跑 lint → typecheck → unit → build → e2e。
- **后果**：
  - standalone 产物仅在 Docker 构建时启用（`BUILD_STANDALONE=1` 触发 `next.config.ts` 中的 `output: "standalone"`）；本地与 CI 用默认输出，`next start` 完全受支持（Next 16 对 standalone + `next start` 有不兼容警告）。
  - `typecheck` 脚本先执行 `next typegen` 再 `tsc --noEmit`（Next 16 路由类型是生成式的，全新 checkout 必须先生成）。
  - SQLite/Drizzle/Auth 库在 #002/#003 再引入，bootstrap 保持零业务依赖。
- **PRD 偏差**：无。

## D-003（Issue #001）数据目录约定

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：`lib/paths.ts` 定义 `DATA_DIR`（默认 `<cwd>/data`，环境变量 `DATA_DIR` 覆盖，Docker 内为 `/data`）与 `ensureDataDirs()`；`data/` 整体 gitignore；compose 用 named volume `capsule-data` 挂载 `/data`。
- **PRD 偏差**：无（对应 PRD §11）。

## D-004（Issue #002）认证库选择：better-auth

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：采用 **better-auth 1.7**（+ 官方 Drizzle 适配器）实现认证。
- **理由**：
  1. 框架无关、与 Next 16 App Router 无版本耦合（NextAuth v5 长期 beta，兼容性风险高）；
  2. 内置 email+password（scrypt 哈希）、数据库 session、cookie 管理（HttpOnly/SameSite/Secure）、Origin 校验（CSRF）、内建 rate-limit——全部满足 PRD §17“不自研协议”的要求；
  3. 一等 Drizzle/SQLite 支持，与既定技术栈一致；
  4. server-side API（`auth.api.*`）可在 Server Action / RSC 中直接调用。
- **映射**：better-auth 的 `user.name` 即需求中的 displayName；`role` 以自定义 additionalField 暂固定为 `admin`（#003 再完整建模角色与 User↔Person 关系）。
- **注意**：`database` 选项只接受适配器实例（不支持函数懒加载），因此 `lib/auth/auth.ts` 模块加载即打开数据库并执行迁移（幂等）；构建期可能触达一次默认 DATA_DIR（可写环境无害）。

## D-005（Issue #002）首次管理员初始化（first-run setup）

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：`/setup` 仅当「数据库无任何 User **且** 环境变量 `INITIAL_SETUP_TOKEN` 已配置」时可用；token 走表单 POST（Server Action）、SHA-256 等长化后 `timingSafeEqual` 比较、不入库不进 URL；初始化请求进程内串行化；成功后 `/setup` 以「存在用户」为闸门永久失效。威胁模型详见 `docs/SECURITY.md` §2。
- **关键教训（已修）**：`/setup` 必须 `export const dynamic = "force-dynamic"`——否则 Next 会在构建期执行 `getSetupState()` 并把结果（甚至重定向）静态冻结。

## D-006（Issue #002）数据库位置与迁移策略

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：SQLite 文件固定在 `$DATA_DIR/db/capsule.sqlite`（随 DATA_DIR 进 Docker volume）；better-sqlite3 + WAL + foreign_keys；Drizzle migration（`db/migrations/`，由 `drizzle-kit generate` 生成）在**首次连接时自动应用**（幂等，`db/index.ts`），dev/prod/Docker 行为一致；不使用内存数据库。
- **注意**：集成/e2e 测试必须通过独立 `DATA_DIR` 隔离；vitest 中环境变量须在**动态导入前**（模块顶层）设置，因为 `lib/paths` 在 import 时读取 `DATA_DIR`。

## D-007（Issue #003）User↔Person 绑定与 onboarding

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：不复制第二套认证 User。在 better-auth `user` 表上增加业务列 `family_id` / `person_id`（可空 FK），additionalFields 以 `input: false` 暴露（客户端不可写入，只能由服务端在 onboarding/绑定时更新）。`person.avatar_asset_id` 暂为普通列，#004 Asset 表落地后再升级 FK。
- **onboarding**：首次登录且未绑定家庭的用户被重定向到 `/onboarding`，一个事务里创建 Family + 女儿 Person（isChild，birthDate 必填）+ 管理员自己的 Person，并写回 user 的 familyId/personId。
- **路由结构**：认证守卫在 `app/(protected)/layout.tsx`（不变）；家庭守卫在嵌套路由组 `app/(protected)/(app)/layout.tsx`——因为服务端 layout 拿不到 pathname，无法在上级判断「当前是否就在 /onboarding」，用嵌套组比每页手写检查更可靠。`/onboarding` 本身位于 (protected) 内（需要登录）。
- **PRD 偏差**：无（PRD §10 的 User 型中 familyId 在 P0 阶段实际可空——管理员先于家庭存在）。

## D-008（Issue #004）Asset 存储与不可覆盖语义

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：
  1. storageKey = `originals/{familyId}/{yyyy}/{mm}/{assetId}.{ext}`（yyyy/mm 取 capturedAt，缺失用导入时间）；derivatives 同构但前缀为 `derivatives/{type}s/`。**上传原 filename 永不进入路径**，只作为展示名存 DB（清洗路径分隔符与控制字符）。
  2. 原件不可覆盖在**存储层强制**：`putOriginal` 对已存在 key 抛 `OriginalExistsError`；写入走临时文件 + rename 原子落盘。衍生物可再生、允许覆盖。
  3. key 安全是白名单而非黑名单：正则限定前缀与字符集、禁止 `..` 与 `//`，resolve 后必须仍在 DATA_DIR 内（纵深防御，主防御是 filename 根本不参与路径）。
  4. 去重以家庭为边界：unique `(familyId, sha256)`。跨家庭允许相同文件（隔离单位是 family，不是全局）。
  5. `person.avatar_asset_id` 在 P0 保持普通可空列（尚未使用）——SQLite 无法 ALTER 加 FK 约束，为未用功能重建 person 表不值得。
  6. LocalFilesystemStorage 的 API 是同步的（better-sqlite3 风格，Node fs 本地写足够快）；大文件流式读取用 `createWebStream` 供媒体端点。
- **PRD 偏差**：无。

## D-009（Issue #006）EXIF 时间缺失时区的解释策略

- **日期**：2026-08-29
- **状态**：已接受
- **背景**：EXIF `DateTimeOriginal` 绝大多数是「拍摄地本地时间」，不带偏移。若凭空按 UTC 解释，时间轴会错 8 小时。
- **决策**：
  1. 有 `OffsetTimeOriginal` / `OffsetTime` → 按显式偏移折算 UTC；
  2. 无偏移 → 按 **Family.timezone** 解释为家庭所在地墙钟时间，两遍法（Intl longOffset）折算 UTC，正确处理 DST；
  3. 墙钟原始值 + 偏移字段完整快照进 `Asset.metadataJson.exif`，事后可重新解释；
  4. 时间优先级：EXIF(DateTimeOriginal > CreateDate) > 文件系统时间（浏览器 `File.lastModified`，本身 UTC ms）> 导入时间（`capturedAt=null` + `timeSource=import_time`，确认事件时用 importedAt 兜底）；
  5. 用户修正 → `timeSource=user_confirmed`，metadata 不动（`updateAssetCapturedAt`）。
- **理由**：单家庭自托管场景下「照片几乎都在家庭时区拍摄」是最佳可得假设；显式偏移存在时永远优先；原始值留档使策略可逆。
- **PRD 偏差**：无（PRD §1.2 只规定优先级，未规定无偏移语义）。

## D-010（Issue #011）音视频摄取与 FFmpeg 的关系

- **日期**：2026-08-29
- **状态**：已接受
- **决策**：
  1. 音频/视频只做「后续上传已有文件」，不做 App 内录制（Capture Anywhere）；上传前先 SHA-256 查重再落盘。
  2. ffprobe 是**增强能力**：存在时提取 duration/creation_time/尺寸（creation_time → embedded_metadata），不存在或失败时返回 null，上传主流程完全不受影响（本机无 ffmpeg 已验证）。探测结果快照进 `metadataJson.ffprobe`。
  3. 浏览器原格式不兼容时未来生成 transcode 衍生物解决（P1），原件永不替换。
  4. 媒体端点实现 HTTP Range（206），音频/视频才能 seek 与流式播放。
  5. 文字条目无 Asset：kind=text 直接落 inbox_item.rawText，occurredAt 在确认时兜底条目创建时间。
- **PRD 偏差**：无。
