# 技术架构

> 本文档与 `docs/PRD.md`（§11、§17、§19、§20）保持一致；冲突时以 PRD 为准，并在 `docs/DECISIONS.md` 记录差异。

## 总体形态

核心档案为**单体全栈应用**，不上微服务。AI 长任务使用共享同一 SQLite 与数据卷
的独立 worker 进程；它是可停止的运维组件，不是核心档案的可用性依赖。

```text
Next.js（App Router）+ TypeScript   单体全栈
Tailwind CSS                        样式（后续按需引入 shadcn/ui）
SQLite（better-sqlite3, WAL）       单文件数据库，位于 $DATA_DIR/db/capsule.sqlite
Drizzle ORM                         schema 在 db/schema/，迁移自动应用
better-auth 1.7                     认证（#002）：session、密码 scrypt、cookie 管理全权委托；限流持久化到 SQLite（v0.1.3）
Sharp                               图片缩略图衍生物（v0.1.3：≤640px WebP，展示层优先）
FFmpeg / ffprobe                    视频元数据/转码（增强能力，非核心硬依赖）
exifr                               EXIF 时间/尺寸解析（#006）
Vitest / Playwright                 单元·集成 / 端到端测试
Docker Compose                      自托管部署
SQLite AI queue + Node worker       可选后台处理；租约/重试/崩溃恢复
```

## 认证与路由保护（#002 起）

- 认证全权交给 better-auth（`lib/auth/auth.ts`）：email+password 登录、数据库 session、`/api/auth/[...all]` 端点。详见 `docs/SECURITY.md`。
- **路由保护用 `(protected)` 路由组的布局层守卫**（`app/(protected)/layout.tsx` 里 `getSession` + `redirect`），不用 middleware：SQLite 原生模块无法在 Edge Runtime 访问数据库，布局守卫覆盖组内全部页面且始终跑在 Node runtime。
- **家庭守卫**（#003 起）：`app/(protected)/(app)/layout.tsx` 要求已绑定家庭，否则重定向 `/onboarding`；`/onboarding` 在 (protected) 内完成一次性建家（Family + 女儿 Person + 自己 Person + User 绑定，事务）。
- 首次初始化：`/setup`（`force-dynamic`）+ `INITIAL_SETUP_TOKEN`，详见 `docs/SECURITY.md` §2。
- 登录/初始化状态类页面必须 `force-dynamic`，禁止构建期静态预渲染（见 `docs/DECISIONS.md` D-005）。

## 数据库（#002 起）

- `db/index.ts`：单例连接，首次连接自动应用 `db/migrations/`（幂等）；`closeDatabase()` 供测试收尾。
- schema 按域拆分在 `db/schema/`；migration 0016 起共有 27 张表和 17 个只向前
  migration（`0000`–`0016`），包括认证、家庭、档案、事件、讲述、胶囊、审计与
  AI 运维域。
- 修改数据模型流程：改 `db/schema/` → `npx drizzle-kit generate` → 迁移文件随代码提交。

## 数据目录（PRD §11）

由 `lib/paths.ts` 的 `ensureDataDirs()` 保证布局；数据库只存元数据和 `storageKey`，大媒体不进数据库。

```text
$DATA_DIR（本地默认 ./data，Docker 内为 /data）
├── originals/          原件，按 yyyy/mm/ 分层；写入后永不覆盖、不改 EXIF
├── derivatives/        可再生衍生物：thumbnails/ previews/ transcodes/ waveforms/
├── exports/            导出产物
└── db/capsule.sqlite      SQLite 主库（WAL/SHM 同目录）
```

- `data/` 整体 gitignore。
- Docker 用 named volume `capsule-data` 挂载 `/data`，容器重建数据不丢。

## Asset Storage 抽象（#004 已落地：`lib/assets/storage.ts`）

业务层不得直接硬编码磁盘目录，一律通过接口：

```ts
interface AssetStorage {
  putOriginal(familyId, assetId, extension, data, dateForPath): PutResult  // 已存在即抛错，原件永不覆盖
  putDerivative(derivativeType, familyId, assetId, extension, data, dateForPath): PutResult
  read(key): Buffer
  createWebStream(key): ReadableStream   // 鉴权媒体端点用
  exists(key): boolean
  delete(key): void
  resolvePath(key): string               // 白名单校验 + 不得越出 DATA_DIR
}
```

- storageKey：`originals/{familyId}/{yyyy}/{mm}/{assetId}.{ext}`（yyyy/mm 取 capturedAt，缺失用导入时间）与 `derivatives/{type}s/{familyId}/{yyyy}/{mm}/{assetId}.{ext}`；上传的原始 filename 永不进入路径。
- 写入策略：临时文件 + rename 原子落盘；key 经正则白名单 + resolve 边界双重校验（防路径穿越）。
- 去重：家庭内 `(familyId, sha256)` 唯一索引；相同原件再上传由服务层返回 duplicate 交 UI 提示（PRD §12）。
- MVP 实现 `LocalFilesystemStorage`；未来增加 `S3Storage`、`WebDAVStorage`。

## 完整导出（#014 已落地：`lib/export/service.ts`）

- `GET /api/export`（需会话+家庭）→ 流式 ZIP 下载，文件同时落 `$DATA_DIR/exports/`。
- 导出前**重读并重算每个原件的 SHA-256**，与库不符抛 `ExportVerificationError`（HTTP 409）——绝不产出看似成功的备份。
- 结构与语义见 `docs/EXPORT_FORMAT.md`；timeline.md 用相对路径引用原媒体；封存胶囊内容始终完整包含（`includeLocked` 语义）。

## AI Provider Adapter（PRD §13）

默认使用 `NullMemoryAssistant`——无 AI key 时功能完整。任何 AI 能力都通过
`MemoryAssistant` 的 text/vision/transcription/embeddings capability 注入，不写死
供应商。外部兼容端点只从服务端环境变量读取，密钥不入库、不发客户端、不导出。

migration 0016 增加 family-scoped SQLite queue、source fingerprint、attempt、lease
generation、worker heartbeat 与逐 capability consent。`/settings/ai` 负责
Provider/model/内容类型披露、admin 同意/撤销以及 job 取消/重试。automatic job
只接受完全 family-visible 来源；受限来源必须逐项手工触发。入队、claim、renew、
finalize 都重新验证实时角色、可见性、来源、Provider/model 和 consent，过期租约
无法提交。

queue 只保存 `{}` payload/output 与有界运维元数据，不保存正文、媒体、secret 或
Provider response。真实结果必须由 handler 在同一事务写入独立衍生表再完成 job。
当前 production registry 为空，尚不会实际转录/分析家庭资料。worker 缺失或停止
不影响核心档案；详见 `docs/AI_PRIVACY.md` 与 `docs/AI_PROVIDERS.md`。

## 认证与安全底线（PRD §17）

- HTTPS 终止在反向代理；
- 使用成熟 Auth 库，不手写认证协议；
- 上传做 MIME/大小校验；用户文件名不直接作为磁盘路径（用 storageKey）；
- 媒体 URL 必须鉴权；
- 默认关闭公开注册；
- 关键删除二次确认；导出/删除操作留审计记录。

## 测试策略

- **单元（Vitest）**：`tests/unit/`，覆盖纯逻辑（路径、时间解析、年龄计算、导出清单等）。
- **集成（Vitest）**：`tests/integration/`，真实 SQLite + better-auth 栈（临时 `DATA_DIR`，环境变量须在动态导入前设置）。
- **端到端（Playwright，RH-006 重构）**：`tests/e2e/`，覆盖 PRD §23 的关键路径。**每个功能 spec 一个独立 project**（`playwright.config.ts`），各自拥有独立 webServer（`scripts/e2e-server.mjs`，参数 PORT / E2E_DATA_DIR）与独立 `data/e2e-<project>` 数据目录（每次运行前清空）——spec 之间零共享状态，任何 spec 可单独执行（`npx playwright test timeline.spec.ts`）。各 spec 通过 `tests/e2e/helpers.ts` 自行 bootstrap（setup → login → onboarding）。完整用户旅程保留在 `full-journey.spec.ts`。
- 每个 Issue 完成时必须 `lint`、`typecheck`、`test`、`build`、`test:e2e` 全绿（PRD §25）。

## 目录结构（PRD §20）

```text
app/          路由（capture/ inbox/ timeline/ memories/[id]/ family/ capsules/ settings/ api/）
components/   UI 组件
db/           schema/ + migrations/（Drizzle）
lib/          auth/ assets/ metadata/ memories/ ai/ export/ security/
jobs/         AI handler registry、租约执行 runtime 与独立 worker 入口
tests/        unit/ + e2e/
docs/         PRD、架构、数据模型、决策、Issue 清单
docker/       Dockerfile（compose 文件在仓库根）
data/         运行数据（gitignore）
```
