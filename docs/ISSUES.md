# 开发路线与 Issue 清单

> 来源：PRD §22（路线）、§23（垂直切片）、§24（Issues）、§27（P0 DoD）。每个 Issue 的执行方式见 PRD §25（固定前缀）与 §26（PR 自检）。

## 状态

| Issue | 标题 | 状态 |
| --- | --- | --- |
| #001 | Bootstrap Next.js + TypeScript + Docker + CI | ✅ 已完成（2026-08-29） |
| #002 | Authentication + private registration policy | ✅ 已完成（2026-08-29，better-auth + 首次 setup 令牌，见 docs/SECURITY.md） |
| #003 | Family / User / Person schema | ✅ 已完成（2026-08-29，family/person 表 + user 表业务 FK + /onboarding + /family 管理页） |
| #004 | AssetStorage abstraction + LocalFilesystemStorage | ✅ 已完成（2026-08-29，storage key 白名单 + 原件不可覆盖 + asset 表 + 去重索引） |
| #005 | Image upload + SHA-256 | ✅ 已完成（2026-08-29，MIME 白名单+魔数嗅探、50MB 限制、SHA-256 查重明确提示、/api/media 鉴权读取、恶意文件名测试） |
| #006 | EXIF capturedAt parser | ☐ |
| #007 | Inbox workflow + UI | ☐ |
| #008 | Confirm InboxItem to MemoryEvent | ☐ |
| #009 | Timeline + child age calculation | ☐ |
| #010 | Multi-select merge into one MemoryEvent | ☐ |
| #011 | Audio / video / text ingestion | ☐ |
| #012 | Contribution model + multi-view UI | ☐ |
| #013 | Capsule model + date/age unlock | ☐ |
| #014 | Full export ZIP | ☐ |
| #015 | Backup/restore design document | ☐ |
| #016 | PWA polish | ☐ |
| #017 | Security audit | ☐ |
| #018 | Playwright critical regression suite | ☐ |

## P0 完成顺序（PRD §22）

```text
Auth → Family/Person → Asset Upload → metadata/hash → Inbox
→ MemoryEvent → Contribution → Timeline → Capsule → Export → Docker
```

发布条件：手机/电脑产生的照片、系统录音、视频和文字都能事后导入，保持真实时间，并能合并成完整记忆事件。

## 垂直切片（PRD §23）

1. **Slice 1**：一张旧照片跑通全链路（登录 → Family/Child → 上传 → SHA-256 → EXIF capturedAt → InboxItem → 确认 → MemoryEvent → Timeline），整条路径写 Playwright。
2. **Slice 2**：上传 5 张照片 → 勾选 → 合并为一个 MemoryEvent（验收：5 Asset，1 Event）。
3. **Slice 3**：音频/视频/文字；FFmpeg 不可用时原件上传仍可工作；文字也先进 Inbox。
4. **Slice 4**：爸爸、妈妈两份 Contribution 独立保存，不能覆盖。
5. **Slice 5**：胶囊创建 → 加内容 → 设日期 → Seal → 到期 Open。
6. **Slice 6**：完整导出，manifest 校验全部 SHA-256，Markdown 相对路径引用媒体。

## P0 Definition of Done（PRD §27）

```text
[ ] 手机/电脑可创建私人家庭空间
[ ] 可创建女儿与家庭成员
[ ] 可后补上传旧照片
[ ] 可上传音频和视频
[ ] 可写文字
[ ] capturedAt / importedAt 分离
[ ] 相同原件可识别重复
[ ] 多素材可合为一个 MemoryEvent
[ ] 多家人可写独立 Contribution
[ ] 时间轴按真实发生时间展示
[ ] 显示事件发生时女儿年龄
[ ] 可创建并封存日期/年龄胶囊
[ ] 可完整 ZIP 导出
[ ] 原件 SHA-256 可验证
[ ] Docker 部署可持续保存数据
[ ] 无 AI key 也完整可用
[ ] 关键 E2E 全绿
[ ] docs 与代码一致
```
