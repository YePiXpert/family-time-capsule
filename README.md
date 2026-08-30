# Family Time Capsule

**P0 v0.1.0 — Trusted Private Timeline（可信私人时间轴）**

A private, self-hosted family memory archive.

随处记录，统一归档。

照片可以来自系统相机，声音可以来自语音备忘录，
视频可以几个月后再补录，文字可以从聊天里复制。

本项目不要求你在「正确的 App」里记录人生。
它只负责把散落在不同地方的真实素材，
整理成一条可以保存几十年的家庭成长时间线。

AI helps organize memories.
Family members tell the story.
Original sources always come first.

> P0 不包含任何 AI 功能——无 API Key 也完整可用。P1 计划见 docs/PRD.md。

---

## 功能一览（P0）

- **私人认证**：无公开注册；首次部署凭 `INITIAL_SETUP_TOKEN` 初始化管理员。
- **家庭与人物**：Person ≠ User——女儿、外公、外婆没有账号也完整存在于记忆里。
- **原件档案**：照片/音频/视频/文字事后上传；SHA-256 去重；**原件永不覆盖**；EXIF 保留真实拍摄时间（`capturedAt` 与 `importedAt` 永不混淆）。
- **收件箱**：新内容先整理再入档；可修正时间（修正后 `timeSource=user_confirmed`）、多选合并成一件事。
- **时间轴**：按真实发生时间排序，显示孩子当时的年龄；晚上传的旧照片不会跑到今天。
- **多人视角**：同一件事，爸爸、妈妈、外婆各自独立讲述，互不覆盖。
- **时间胶囊**：按日期或孩子年龄封存开启；封存是仪式不是加密——导出永远完整。
- **完整导出**：ZIP 内含全部原件（哈希校验）+ JSON + 可读 Markdown，离开本系统一切仍可打开。

## 技术栈

Next.js 16（App Router）+ TypeScript strict + Tailwind CSS v4 + SQLite（better-sqlite3 + Drizzle ORM）+ better-auth + exifr + archiver + Vitest / Playwright + Docker。

## 本地开发

```bash
npm install
cp .env.example .env   # 按需调整 DATA_DIR / AUTH_SECRET / INITIAL_SETUP_TOKEN
npm run dev            # http://localhost:3000
```

### 首次初始化（私有注册策略）

本项目**没有公开注册**。首次部署后：

1. 在 `.env` 中设置 `INITIAL_SETUP_TOKEN`（一次性令牌）与 `AUTH_SECRET`；
2. 访问 `/setup`，凭令牌创建第一个管理员账号；
3. 初始化完成后 `/setup` 永久失效（即使令牌仍在），之后用 `/login` 登录；
4. 首次登录进入 `/onboarding`：创建家庭、孩子档案，并绑定自己。

详见 [docs/SECURITY.md](docs/SECURITY.md)。

常用脚本：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run lint` / `npm run typecheck` | 静态检查 |
| `npm test` | Vitest 单元 + 集成测试（126 个） |
| `npm run test:e2e` | Playwright 端到端（会先自动 build，使用独立的 data/e2e 数据目录） |
| `npm run verify:export <zip>` | 校验导出 ZIP 的 manifest 与全部原件 SHA-256 |

## 备份与迁移

> **`/data` 是不可替代的持久数据。** 其中两样缺一不可：
> `db/capsule.sqlite`（家庭、人物、事件、讲述的全部结构化数据）与
> `originals/`（**全部照片/录音/视频原始字节**）。只复制 sqlite 会丢掉所有媒体；
> 只复制媒体会丢掉标题、真实时间与讲述。**二者必须一起备份。**

- 应用内导出：设置页「导出完整备份（ZIP）」或 `GET /api/export`；
  导出前服务端重验每个原件哈希，ZIP 可直接阅读/播放、可跨实例恢复；
- 独立校验：`npm run verify:export <zip>`；
- 灾难恢复：新实例 `/setup` 创建管理员后 `DATA_DIR=/data npm run restore -- backup.zip`，
  再到 `/onboarding` 选择「你是谁」完成绑定（认证凭据永不来自备份）；
- 基础 3-2-1 与「停容器 → tar volume」等经过验证的备份命令：
  见 [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) §6；
- 导出格式与兼容承诺：[docs/EXPORT_FORMAT.md](docs/EXPORT_FORMAT.md)；
  恢复设计与安全校验：[docs/RESTORE.md](docs/RESTORE.md)。

## Docker 部署

```bash
AUTH_SECRET=$(openssl rand -base64 32) INITIAL_SETUP_TOKEN=<一次性令牌> docker compose up -d --build
```

所有原件、衍生物、导出与数据库都保存在 named volume `capsule-data`（挂载为容器内 `/data`），重建容器数据不丢失。`AUTH_SECRET` 未设置时 compose 拒绝启动。

## 文档

- [docs/PRD.md](docs/PRD.md) — 产品计划书（唯一需求来源）
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 技术架构与存储约定
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — 核心数据模型
- [docs/SECURITY.md](docs/SECURITY.md) — 安全基线与威胁模型（含 #017 审计结论）
- [docs/ISSUES.md](docs/ISSUES.md) — 开发路线、垂直切片与 Issue 清单
- [docs/DECISIONS.md](docs/DECISIONS.md) — 关键决策记录（ADR）
- [docs/EXPORT_FORMAT.md](docs/EXPORT_FORMAT.md) / [docs/RESTORE.md](docs/RESTORE.md) — 导出格式与恢复设计
- [CHANGELOG.md](CHANGELOG.md) — 版本记录
