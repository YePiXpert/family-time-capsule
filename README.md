# Family Time Capsule

**1.0.0-dev.1 / 正式 1.0 开发预发布版**

安装包与升级说明见 [v1.0.0-dev.1 Release](https://github.com/YePiXpert/family-time-capsule/releases/tag/v1.0.0-dev.1)。
网页更新后刷新即可；构建 14 及更早的原生 App 需更新安装包，构建 15 与本版服务端兼容。

从出生开始，留下照片、声音和想对你说的话，慢慢写成送给你的成长礼物。

需求、自动化证据与真实验收分别记录于 [正式 1.0 追踪文档](docs/release-1.0/REQUIREMENTS.md)、
[验收清单](docs/release-1.0/ACCEPTANCE.md) 和 [外部阻塞](docs/release-1.0/BLOCKERS.md)。

A private, self-hosted family memory archive.

照片可以来自系统相机，声音可以来自语音备忘录，
视频可以几个月后再补录，文字可以从聊天里复制。

本项目不要求你在「正确的 App」里记录人生。
它只负责把散落在不同地方的真实素材，
整理成一条可以保存几十年的家庭记忆时间线。

AI helps organize memories.
Family members tell the story.
Original sources always come first.

> AI 默认关闭、始终可选；没有 API Key、Provider 或 worker 时，核心档案仍完整可用。
> 当前是正式 1.0 开发期：自动化、Docker 与原生包级门禁通过后发布 prerelease；系统分享、
> Files/iCloud/DocumentsProvider、通知和真实设备媒体行为仍必须按
> [真实设备验收](docs/REAL_DEVICE_TEST.md) 留档，不能由编译结果代替。

---

## 日常使用

界面采用暖白与蜜桃粉的成长手帐风格，首页显示孩子档案中的真实年龄。
轻玻璃仅用于导航与浮动记录入口；系统减少透明度或不支持模糊时使用实底。
新建成长书提供照片册、图文成长记两种模板；历史作品继续兼容。


Web 和 Android/iOS 共用三个主要入口：**成长、成长册、我的**，通过「记录一刻」新增。打开应用直接回到成长时间轴，
设置集中在「家人和账号、存储与同步、备份与恢复、显示与辅助」四组。
大字显示只调整字号和触控区域，保留相同菜单。

- **成长**：按真实发生日期浏览、搜索和筛选；日期不确定时如实标注。
  人物年龄参考可选。同一件事可以保留多位家人的独立讲述。
  有待确认内容或需要继续的导入时，才显示待处理入口。
- **记录**：选照片、拍摄、录音、添加文件或写一句话，然后点一次「保存」。
  草稿自动保存在本机；标题、日期、地点和人物可以之后补充。读者范围始终可见。
  有整理权限的成员直接保存为记忆，贡献者保存到家庭待确认列表。
- **成长册**：选择相册或家庭书，点新建、选记忆、生成预览；标题和封面自动生成。
  点编辑后可调整文字、章节、顺序、模板、版式和图片裁切焦点。
  家庭书提供内容、版式和整本设置，支持自动保存、版本快照、恢复和冲突保留。
- **原件与权限**：原件不覆盖，SHA-256 去重和完整性校验；记忆支持全家、指定成员、
  仅自己。家庭作品和私人作品按来源权限校验，相册不会扩大原记忆的读者范围。
- **离线与同步**：React Native 使用本机存储，支持离线记录、系统分享和断点续传。
  可主动下载相册和家庭书离线阅读；作品编辑需要连接家庭服务器。
- **导出与恢复**：家庭书可导出中文 PDF、EPUB 和解压即读的精选阅读包。
  完整档案 ZIP 保留原件、哈希、结构化数据、顺序、版式和版本；另有本机备份、
  服务器备份与 WebDAV 备份。没有 AI 也可完成核心流程。
- **可选 AI**：转录、图片理解、起名和信息建议；保存后仅按已有的自动处理授权排队。
  手动处理授权不会被扩大为自动授权，私密内容需有权成员单独触发。
  AI 不自动确认人物、时间、事实或合并记忆。

独立故事、口述史任务、访客投递箱、定时胶囊和每周回顾流程已移除。
版本 4 完整档案不再包含这些模块；仍可读取旧版本备份中的核心记录。
数据库升级前创建恢复快照；带有旧故事来源的家庭书需要先转换来源，升级不会将它变成无来源作品。

## 账号与资料收集

无公开注册；首次部署凭 `INITIAL_SETUP_TOKEN` 初始化管理员，再邀请家人加入。
家人档案与登录账号分开：没有账号的家人也可以出现在记忆中。
照片、音频、视频、PDF、TXT、Markdown、RTF 和 DOCX 原件可通过 Web、系统分享或
Files/iCloud/DocumentsProvider 收集。收件箱支持继续编辑、合并和确认。

## 技术栈

服务端：Next.js 16（App Router）+ TypeScript strict + Tailwind CSS v4 + SQLite
（better-sqlite3 + Drizzle ORM）+ better-auth + Docker。原生端：Expo SDK 57 +
React Native + 原生 SQLite/SecureStore/FileSystem；不是 PWA/WebView 套壳。

## 本地开发

服务端断点上传在 Linux（含官方容器）使用 `flock`（util-linux）保护跨进程原件写入：锁文件不靠删除解锁，进程退出由内核释放。非 Linux 开发机（Windows/macOS）原生 `npm run dev` 亦可运行——上传锁降级为进程内互斥，单个开发服务器进程内语义不变，只是不提供跨进程保护；生产部署仍应使用 Linux 容器。

```bash
npm install
cp .env.example .env   # 按需调整 DATA_DIR / AUTH_SECRET / INITIAL_SETUP_TOKEN
npm run dev            # http://localhost:3000
```

### 一键本地演示

不想到走初始化流程、只想先看产品样子：

```bash
npm run demo           # 首次自动生成合成演示数据，然后启动服务端 + worker
```

浏览器打开 <http://localhost:3000/login>，用 `demo@family.local` / `demo-family-2026` 登录。
演示数据在独立的 `demo-data/` 目录（不碰 `./data` 正式档案）：合成「小满家」四口人、
15 条跨三年、六档日期精度的记忆（程序生成的插画照片与 WAV 音频，无任何真实人物数据）、
一条仅自己可见的私密记忆和置顶成长节点。
`npm run demo -- --reset` 随时重建；只生成数据不启动服务用 `npm run demo:seed`。

### 首次初始化（私有注册策略）

本项目**没有公开注册**。首次部署后：

1. 在 `.env` 中设置 `INITIAL_SETUP_TOKEN`（一次性令牌）与 `AUTH_SECRET`；
2. 访问 `/setup`，凭令牌创建第一个管理员账号；
3. 初始化完成后 `/setup` 永久失效（即使令牌仍在），之后用 `/login` 登录；
4. 首次登录进入 `/onboarding`：创建家庭并绑定自己，孩子档案可跳过。

详见 [docs/SECURITY.md](docs/SECURITY.md)。

常用脚本：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run lint` / `npm run typecheck` | 静态检查 |
| `npm test` | Vitest 单元 + 集成测试 |
| `npm run test:e2e` | Playwright 场景 + 生产灾难恢复 roundtrip（会先 build） |
| `npm run verify:export <zip>` | 校验导出 ZIP 的 manifest 与全部原件 SHA-256 |

原生客户端开发、设备数据边界和 GitHub 云构建 IPA/APK：
[docs/MOBILE.md](docs/MOBILE.md)。

## 备份与迁移

> **`/data` 是不可替代的持久数据。** 其中两样缺一不可：
> `db/capsule.sqlite`（家庭、人物、事件、讲述的全部结构化数据）与
> `originals/`（**全部照片/录音/视频原始字节**）。只复制 sqlite 会丢掉所有媒体；
> 只复制媒体会丢掉标题、真实时间与讲述。**二者必须一起备份。**

- 应用内导出：设置页「导出完整备份（ZIP）」或 `GET /api/export`；
  导出前服务端重验每个原件哈希，ZIP 可直接阅读/播放、可跨实例恢复；
- 独立校验：`npm run verify:export <zip>`；
- 灾难恢复：新实例 `/setup` 创建管理员后，本地用 `DATA_DIR=/data npm run restore -- backup.zip`；
  Compose 生产容器用 `docker compose exec app node /app/ops/restore.mjs /path/to/backup.zip`，
  再到 `/onboarding` 选择「你是谁」完成绑定（认证凭据永不来自备份）；
- 基础 3-2-1 与「停容器 → tar volume」等经过验证的备份命令：
  见 [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) §6；
- 导出格式与兼容承诺：[docs/EXPORT_FORMAT.md](docs/EXPORT_FORMAT.md)；
  恢复设计与安全校验：[docs/RESTORE.md](docs/RESTORE.md)。

## Docker 部署

```bash
AUTH_SECRET=$(openssl rand -base64 32) \
BETTER_AUTH_URL=http://localhost:3000 \
INITIAL_SETUP_TOKEN=<一次性令牌> \
docker compose up -d --build --wait
```

所有原件、衍生物、导出与数据库都保存在 Compose 逻辑卷 `capsule-data`（挂载为容器内 `/data`；实际卷名通常为 `<项目名>_capsule-data`），重建容器数据不丢失。备份命令必须从正在运行的 `app` 容器解析实际 `/data` 卷名，详见部署清单 §6。`AUTH_SECRET` 未设置时 compose 拒绝启动。
`BETTER_AUTH_URL` 也必须设置为浏览器实际访问的唯一 origin（反代时填最终 HTTPS
地址）；填错会安全拒绝登录。`app` 与 `worker` 都有各自适用的健康检查。

## 文档

- [正式 1.0 REQUIREMENTS](docs/release-1.0/REQUIREMENTS.md) — 当前需求唯一来源
- [docs/PRD.md](docs/PRD.md) — 探索期产品计划书
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 技术架构与存储约定
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — 核心数据模型
- [docs/SECURITY.md](docs/SECURITY.md) — 安全基线与威胁模型（含 #017 / RH-010 审计结论）
- [docs/ISSUES.md](docs/ISSUES.md) — 开发路线、垂直切片与 Issue 清单
- [docs/DECISIONS.md](docs/DECISIONS.md) — 关键决策记录（ADR）
- [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) — 部署、冒烟、持久性验证与备份/灾难恢复手册
- [docs/REAL_DEVICE_TEST.md](docs/REAL_DEVICE_TEST.md) — 真实设备手工验收清单（正式录入前执行）
- [docs/MOBILE.md](docs/MOBILE.md) — 原生客户端、本地数据、同步协议与云构建
- [docs/RELEASE_1.0.md](docs/RELEASE_1.0.md) — 1.0 RC 自动化、Docker 与外部门禁报告
- [docs/RELEASE_1_1.md](docs/RELEASE_1_1.md) — 1.1 alpha 自动化、云包与未完成真机门禁
- [docs/EXPORT_FORMAT.md](docs/EXPORT_FORMAT.md) / [docs/RESTORE.md](docs/RESTORE.md) — 导出格式与恢复设计
- [CHANGELOG.md](CHANGELOG.md) — 版本记录
