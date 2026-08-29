# 恢复设计（RESTORE）

> P0 不提供恢复 UI（Issue #015 交付的是设计与校验工具）。本文档定义：
> 如何从 [EXPORT_FORMAT.md](./EXPORT_FORMAT.md) 的 ZIP 恢复数据、
> 如何处理哈希校验 / 重复 / ID 映射 / 用户关系，以及未来迁移策略。

## 0. 铁律

1. **先校验，后恢复**：任何恢复动作前必须通过哈希校验（见 §2）。
2. **绝不覆盖现存数据**：恢复是合并导入，不删除、不改写现有家庭内容。
3. **原件只增不改**：导入的原件按新 Asset 落盘（除非 SHA-256 已存在），永不覆盖。
4. **认证数据不导入**：user/session/account 属于部署实例，不属于家庭档案；
   Person/User 的绑定在恢复后手工重建设计（§5）。

## 1. 校验工具（已随 #015 提供）

```bash
npm run verify:export path/to/family-time-capsule-export-*.zip
```

检查项：

- ZIP 可解压，`family-time-capsule-export/manifest.json` 存在且可解析；
- `exportVersion` 为受支持的大版本（当前 1）；
- manifest.assets 中每一项：
  - `relativePath` 在 ZIP 内存在；
  - 字节数与 `bytes` 一致；
  - 实际 SHA-256 与 `sha256` 一致；
- 必需 JSON（family/people/memories/contributions/facts/capsules）存在且可解析；
- memories/contributions/capsules 引用的 `assetIds`/`personId` 在导出内有定义。

任何一项失败 → 非零退出码并列出失败条目。**校验失败的同时也可能意味着备份介质损坏，应换一份备份再试。**

## 2. 哈希校验失败的处理

| 现象 | 处理 |
| --- | --- |
| 单个原件哈希不符 | 拒绝恢复该 Asset，其余可恢复；报告中列出损坏文件 |
| manifest 缺失/损坏 | 拒绝整个恢复 |
| 字节数不符但哈希相符 | 不可能（SHA-256 抗碰撞），视为工具 bug 处理 |

导出侧已内置同等校验（导出时重算，不符则导出失败），因此「导出成功 + 导入校验失败」
组合几乎必然意味着**存储介质在导出之后损坏**。

## 3. 重复 Asset 的合并策略

以 `(familyId, sha256)` 为唯一键（与库内唯一索引一致）：

- 导入的 Asset 哈希已存在 → 复用现有 Asset 行，**不重复落盘**；
  但其关系（属于哪个事件/胶囊）仍然导入。
- 哈希不存在 → 新建 Asset，文件写入 `originals/{familyId}/{yyyy}/{mm}/{assetId}.{ext}`
  （yyyy/mm 取 capturedAt，与正常上传同构）。
- `metadataJson`：现存行为准（导出不改写已确认的档案）。

## 4. 不同 family ID 的处理

- 恢复到一个**已存在**的家庭：所有实体 ID 需要重映射
  （`oldId → newId`），关系表按映射重建；family 元信息（name/timezone）不覆盖，
  由管理员决定是否采纳导出值。
- 恢复到一个**空实例**：直接按导出的原始 UUID 建库，ID 不变；
  `family.id` 采用导出值，使未来导出可对账。
- 两边都可能有同 ID 的不同实体（极小概率 UUID 撞车 / 从同源分叉）：
  冲突时新导入方一律生成新 ID 并记录在恢复报告里。

## 5. Person / User 关系恢复

- `people.json` 全量导入为 Person（含无账号成员）。
- User（登录账号）不导入。恢复后：
  1. 管理员在新实例 `/setup` 创建账号；
  2. onboarding 时选择「恢复已有家庭」→ 从 people.json 选择自己对应的 Person；
  3. `user.personId` 绑定到该 Person（`bindUserToPerson`，服务端校验同家庭）。
- 时间线、事件、胶囊的完整性**不依赖任何 User 存在**（Person ≠ User）。

## 6. 恢复算法（P1 实现蓝本）

```text
verify:export 全绿
→ 开事务
→ family：采用/映射（§4）
→ people：按 id 映射导入
→ assets：逐个 §3 合并（哈希存在则复用）
→ memories：按映射导入事件 + memory_event_asset / participant 关系
→ contributions / facts：按映射导入
→ capsules：按映射导入 + 关系（内容引用始终完整，不论 sealed）
→ 提交；输出恢复报告（新增 N / 复用 M / 跳过 K + 原因）
```

单事务保证半恢复状态不落库；大媒体文件先落盘后入库（入库失败则删除已落盘文件）。

## 7. 未来迁移

- `exportVersion` 升级只做增量字段；旧导出按「缺失字段取默认值」读取。
- 数据库 schema 迁移与导出格式解耦：恢复工具按 exportVersion 读，
  不按 DB migration 版本读。
- `stories/`（P1 章节产物）恢复为只读文件，不建表——Story 生成物永远可以从
  user_confirmed Fact + Contribution 重新生成（事实锁，PRD §14）。
