# 技术架构

> 本文档与 `docs/PRD.md`（§11、§17、§19、§20）保持一致；冲突时以 PRD 为准，并在 `docs/DECISIONS.md` 记录差异。

## 总体形态

MVP 为**单体全栈应用**，不上微服务。媒体处理变复杂后再拆 Worker。

```text
Next.js（App Router）+ TypeScript   单体全栈
Tailwind CSS                        样式（后续按需引入 shadcn/ui）
SQLite（better-sqlite3, WAL）       单文件数据库，位于 $DATA_DIR/db/capsule.sqlite
Drizzle ORM                         schema 在 db/schema/，迁移自动应用
better-auth 1.7                     认证（#002）：session、密码 scrypt、cookie 管理全权委托
Sharp                               图片衍生物（后续）
FFmpeg / ffprobe                    视频元数据/转码（增强能力，非核心硬依赖）
Vitest / Playwright                 单元·集成 / 端到端测试
Docker Compose                      自托管部署
```

## 认证与路由保护（#002 起）

- 认证全权交给 better-auth（`lib/auth/auth.ts`）：email+password 登录、数据库 session、`/api/auth/[...all]` 端点。详见 `docs/SECURITY.md`。
- **路由保护用 `(protected)` 路由组的布局层守卫**（`app/(protected)/layout.tsx` 里 `getSession` + `redirect`），不用 middleware：SQLite 原生模块无法在 Edge Runtime 访问数据库，布局守卫覆盖组内全部页面且始终跑在 Node runtime。
- **家庭守卫**（#003 起）：`app/(protected)/(app)/layout.tsx` 要求已绑定家庭，否则重定向 `/onboarding`；`/onboarding` 在 (protected) 内完成一次性建家（Family + 女儿 Person + 自己 Person + User 绑定，事务）。
- 首次初始化：`/setup`（`force-dynamic`）+ `INITIAL_SETUP_TOKEN`，详见 `docs/SECURITY.md` §2。
- 登录/初始化状态类页面必须 `force-dynamic`，禁止构建期静态预渲染（见 `docs/DECISIONS.md` D-005）。

## 数据库（#002 起）

- `db/index.ts`：单例连接，首次连接自动应用 `db/migrations/`（幂等）；`closeDatabase()` 供测试收尾。
- schema 按域拆分在 `db/schema/`：`auth.ts`（better-auth 四表 + #003 的 user 业务 FK 列）、`family.ts`（family/person）。
- 修改数据模型流程：改 `db/schema/` → `npx drizzle-kit generate` → 迁移文件随代码提交。

## 数据目录（PRD §11）

由 `lib/paths.ts` 的 `ensureDataDirs()` 保证布局；数据库只存元数据和 `storageKey`，大媒体不进数据库。

```text
$DATA_DIR（本地默认 ./data，Docker 内为 /data）
├── originals/          原件，按 yyyy/mm/ 分层；写入后永不覆盖、不改 EXIF
├── derivatives/        可再生衍生物：thumbnails/ previews/ transcodes/ waveforms/
├── exports/            导出产物
└── family-time-capsule.sqlite（Issue #003 起）
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

## AI Provider Adapter（PRD §13）

P0 使用 `NullMemoryAssistant`——无 AI key 时功能完整。任何 AI 能力都通过 `MemoryAssistant` 接口注入，不写死供应商。AI 只产出候选与建议，绝不自动制造 `user_confirmed` Fact（事实锁见 PRD §14）。

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
- **端到端（Playwright）**：`tests/e2e/`，覆盖 PRD §23 的关键路径。webServer（`scripts/e2e-server.mjs`）使用**独立的 `data/e2e` 数据目录**（每次运行前清空）跑生产构建，端口 3100，不污染开发数据；单 worker 串行，因为用例共享一次 setup→login→logout 的状态推进。
- 每个 Issue 完成时必须 `lint`、`typecheck`、`test`、`build`、`test:e2e` 全绿（PRD §25）。

## 目录结构（PRD §20）

```text
app/          路由（capture/ inbox/ timeline/ memories/[id]/ family/ capsules/ settings/ api/）
components/   UI 组件
db/           schema/ + migrations/（Drizzle）
lib/          auth/ assets/ metadata/ memories/ ai/ export/ security/
jobs/         后台任务（未来 Worker 化）
tests/        unit/ + e2e/
docs/         PRD、架构、数据模型、决策、Issue 清单
docker/       Dockerfile（compose 文件在仓库根）
data/         运行数据（gitignore）
```
