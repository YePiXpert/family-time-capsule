# 恢复设计（RESTORE）

> v0.1.1 起恢复已实现（RH-004）：`npm run restore -- backup.zip`。
> 本文档定义：恢复前置条件、CLI 流程、安全校验、以及未来迁移策略。
> 导出格式见 [EXPORT_FORMAT.md](./EXPORT_FORMAT.md)。

## 0. 铁律

1. **先校验，后恢复**：任何写入前必须通过全部校验（§2）。
2. **绝不覆盖现存数据**：只允许恢复到「无 Family」的实例；目标非空 → 明确拒绝（`target_not_empty`）。
3. **原件只增不改**：恢复的原件按原 assetId 落盘（`putOriginal`，已存在即报错）。
4. **认证数据不恢复**：user/session/account 永不来自备份。

## 1. 恢复流程（已实现）

```text
# 1) 在新实例上创建管理员（认证从零开始，不用备份里的旧凭据）
#    访问 /setup（需 INITIAL_SETUP_TOKEN）创建账号
#
# 2) 恢复归档（DATA_DIR 指向该实例）
DATA_DIR=/data npm run restore -- /path/to/backup.zip [--user <userId>]
# Docker Compose 的生产镜像使用已编译、无需 tsx/源码的运维产物：
docker compose exec app node /app/ops/restore.mjs /path/to/backup.zip [--user <userId>]
#
# 3) 管理员登录 → 访问 /onboarding → 检测到已恢复的家庭 → 选择「你是谁」完成绑定
```

CLI 内部执行顺序（对应 RH-004 要求 1–18）：

1. 读取 ZIP；2. 校验 `exportVersion`；3. 解析 manifest；4. **逐个复核原件 SHA-256**；
5. 校验全部实体 JSON 结构；6. **ZIP 条目名 path traversal 校验**；
7. 校验目标实例无 Family / 无 Person；8–16. 写入原件文件（失败回滚删除）→
单事务恢复 Family → Person → Asset → MemoryEvent → InboxItem → InboxItemAsset →
事件关联表 → Contribution → Fact → Capsule（含内容引用）；17. 在同一事务提交前执行
**行数复核**（包括 InboxItem、InboxItemAsset、事件素材/参与人关系，以及胶囊的事件/素材/
讲述关系，均与导出逐项一致），复核通过才提交；
18. 任一写入或复核失败：事务回滚并删除已写文件，**不存在半恢复数据库**。提交后的审计为
best-effort，不会把已经成功提交的恢复改报为失败。

## 2. 安全校验（RH-010）

| 校验 | 失败码 |
| --- | --- |
| 条目名逃逸导出根目录 / `..` / 盘符 / 反斜杠 | `unsafe_entry` |
| 条目数 > 200,000 | `too_many_entries` |
| 单文件解压 > 2GB | `file_too_large` |
| 总解压 > 25GB（zip bomb） | `zip_bomb` |
| `exportVersion` 不在支持列表 | `unsupported_version` |
| manifest/JSON 损坏、引用缺失（未知 person/event/asset） | `bad_manifest` / `bad_json` / `bad_refs` |
| inbox 两个增量 JSON 只存在一个 | `missing_json` |
| 任何原件 SHA-256/字节数不符 | `hash_mismatch` |
| 目标实例已有家庭数据 | `target_not_empty` |
| operator 用户不存在 | `bad_operator` |
| manifest 中重复 assetId | `bad_manifest` |

限额可通过 `restoreFromZip(buffer, userId, { limits })` 注入（运维/测试用）。

### 2.1 收件箱归档的完整性与旧档兼容

- 新导出必须同时包含 `inbox-items.json` 与 `inbox-item-assets.json`。旧的
  `exportVersion: 1` 归档若**两者都不存在**，恢复端按两个空数组处理，因此仍可恢复；
  若恰好缺一个则以 `missing_json` 拒绝，避免只恢复条目或只恢复关系。
- 两个文件存在时必须都是数组。恢复端校验 InboxItem 的 ID 唯一、`familyId` 与 manifest
  一致、`kind`/`status` 合法、`rawText` 类型与时间合法；合法状态包括 `new`（待处理）、
  `processing`、`needs_review`、`confirmed`、`discarded`。
- `memoryEventId` 可为 `null`；非空时必须引用 `memories.json` 中的事件。
  每条 InboxItemAsset 的 ID 必须唯一，`familyId` 必须一致，且 `inboxItemId` 必须引用
  `inbox-items.json`、`assetId` 必须引用 manifest 中的原件。任何悬空或跨家庭引用均以
  `bad_refs` 在写入前拒绝。
- 通过校验后，恢复按导出值原样写入条目 ID、状态、完整 `rawText`、时间、
  `memoryEventId` 与每条素材关联，不截断长文字、不重建或合并关联行。提交前在同一事务内
  分别复核 InboxItem 与 InboxItemAsset 行数；不一致则 `post_verify_failed` 并完整回滚。
- 已确认文字通过 `memoryEventId` 回到对应 MemoryEvent，详情页将完整正文显示为无作者的
  “文字记录”。恢复不会为它创建 Contribution，也不会虚构作者；同一事件的多条文字保持
  多条独立来源记录。

## 3. 哈希校验失败的处理

单个原件不符 → **整个恢复拒绝**（比逐文件跳过更保守）：备份介质可疑时应换一份备份重试。
导出侧的强校验 + 恢复侧的强校验组合下，「导出成功 + 恢复校验失败」几乎必然意味着
备份文件在导出之后损坏或被篡改。

## 4. 重复 Asset / 不同 family ID

- v0.1.1 恢复目标必须是空实例 → 导出的原始 UUID 直接沿用，**无 ID 重映射需求**。
- 若实例需要「合并导入」已有家庭：明确不支持（高风险 merge 被禁止）；
  正确做法是恢复到一个新实例，再从该实例按需导出/迁移。
- 重复 `(familyId, sha256)` 不可能出现在 v0.1.1 路径（空实例 + manifest 去重校验）。

## 5. Person / User 关系恢复

- `people.json` 全量恢复为 Person（含无账号成员），ID 原样保留。
- 恢复完成后：管理员登录 → `/onboarding` 自动检测「实例已有家庭」→
  显示绑定表单（选择自己是哪位成员；孩子档案不能作为登录身份）→
  `user.familyId / personId` 写入（`bindRestoredFamily`，服务端校验）。
- 时间线、事件、胶囊的完整性**不依赖任何 User 存在**（Person ≠ User）。

## 6. 测试

- `tests/integration/restore.test.ts`：A 建档（照片+音频+视频+文字+3 事件+讲述+事实+封存胶囊）
  → 导出 → 空实例 B setup → restore → 全量比对（sha256/字节/occurredAt/关系/胶囊）；
  外加 7 个恶意输入用例（篡改哈希/坏版本/路径穿越/malformed manifest/解压限额/非空目标/坏 operator）。
- `tests/roundtrip/restore-roundtrip.test.ts`（`npm run test:e2e` 末尾执行）：
  A 建档 → export → **销毁 A** → 干净 B → restore → **启动真实服务器** →
  登录 → 时间轴/详情核对 → 媒体字节+Range+401 → 导出 B → verify:export CLI 全绿。

P0 收件箱完整性的计划验收覆盖（在相应用例落地并通过前，不作为已完成声明）：

- 导出集成：断言两个 inbox 文件与 `fileCount = assetCount + 10`，逐行比对超过 100 字的
  待处理文字、待处理素材、`needs_review`、`discarded`、已确认文字及其素材关联。
- 恢复集成：逐项比对上述条目的 ID、状态、完整正文、`memoryEventId`、时间与关联行；验证
  两个文件都缺失的旧归档可恢复、只缺一个会拒绝，以及悬空 event/item/asset 引用会拒绝。
- 生产 roundtrip：A → export → 销毁 A → B restore → 真实服务器详情页仍能读取已确认文字
  的完整正文，且以无作者来源记录呈现，不产生虚构 Contribution 作者。

## 7. 未来迁移

- `exportVersion` 升级只做增量字段；恢复端对缺失字段取默认值
  （如 `type` 由目录推断、`timeSource` 按 capturedAt 推断、文件名回退 assetId.ext）。
- merge-into-existing、ID 重映射、增量导入均在 backlog，需先定义安全合并语义。
