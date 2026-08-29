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
