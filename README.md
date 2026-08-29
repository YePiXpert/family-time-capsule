# Family Time Capsule

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

---

## 技术栈

Next.js (App Router) + TypeScript + Tailwind CSS + SQLite (Drizzle ORM，随 Issue #003 引入) + Docker。

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
3. 初始化完成后 `/setup` 永久失效（即使令牌仍在），之后用 `/login` 登录。

详见 [docs/SECURITY.md](docs/SECURITY.md)。

常用脚本：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run lint` | ESLint |
| `npm run typecheck` | 路由类型生成 + `tsc --noEmit` |
| `npm test` | Vitest 单元 + 集成测试 |
| `npm run test:e2e` | Playwright 端到端测试（会先自动 build，使用独立的 data/e2e 数据目录） |

## Docker 部署

```bash
AUTH_SECRET=$(openssl rand -base64 32) INITIAL_SETUP_TOKEN=<一次性令牌> docker compose up -d --build
```

所有原件、衍生物、导出与数据库都保存在 named volume `capsule-data`（挂载为容器内 `/data`），重建容器数据不丢失。`AUTH_SECRET` 未设置时 compose 拒绝启动。

## 文档

- [docs/PRD.md](docs/PRD.md) — 产品计划书（唯一需求来源）
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 技术架构与存储约定
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — 核心数据模型
- [docs/SECURITY.md](docs/SECURITY.md) — 安全基线与威胁模型
- [docs/ISSUES.md](docs/ISSUES.md) — 开发路线、垂直切片与 Issue 清单
- [docs/DECISIONS.md](docs/DECISIONS.md) — 关键决策记录（ADR）
