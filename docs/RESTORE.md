# 恢复设计（RESTORE）

> v0.1.1 起恢复已实现（RH-004）：`npm run restore -- backup.zip`。
> 本文档定义：恢复前置条件、CLI 流程、安全校验、以及未来迁移策略。
> 导出格式见 [EXPORT_FORMAT.md](./EXPORT_FORMAT.md)。

## 0. 铁律

1. **先预验，后入库**：结构、metadata 与引用在写文件前全部校验；每份原件在流式落盘时
   复核实际字节数/SHA-256，全部通过后才开启数据库事务。任一失败删除此前文件（§2）。
2. **绝不覆盖现存数据**：只允许恢复到「无 Family」的实例；目标非空 → 明确拒绝（`target_not_empty`）。
3. **原件只增不改**：恢复的原件按原 assetId 落盘（`putOriginalStream`，已存在即报错）。
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

1. 校验目标实例无 Family / 无 Person；2. 校验 operator 是未禁用、未绑定的 setup admin；
3. 用 `stat` 检查压缩包本体大小，以文件句柄打开 ZIP 并枚举 Central Directory（不把压缩包
载入 JS heap）；4. 校验重复/加密/压缩方法、条目名与解压限额；5. 校验 `exportVersion` 与 manifest；
6. 校验全部实体 JSON、关系、家庭解锁年龄与周设置、显式 guardian/手工解锁、Contribution
可见性/音频引用/可迁移 recorder provenance、Transcript、Import/Portal/Review/Story 引用；
7. 结构预验通过后，
**逐个打开 entry stream → 边写临时文件边复核字节数/SHA-256 → hard-link 原子发布**
（失败回滚此前文件）；内存中不保留压缩包或完整解压原件；8–16. 然后
单事务恢复 Family → Person → Asset → MemoryEvent → MemoryEventTag → InboxItem → InboxItemAsset →
ImportSession/Item/default participant → Contribution Request/Portal submissions → 事件关联表 →
Contribution → Fact → FactSource → Transcript → Story/Source → ReviewPeriod/Event → Capsule；
17. 在同一事务提交前执行**逐表行数复核**（包括上述 1.1 关系、事件素材/参与人关系与胶囊
内容关系，均与导出逐项一致），复核通过才提交；
18. 任一写入或复核失败：事务回滚并删除已写文件，**不存在半恢复数据库**。提交后的审计为
best-effort，不会把已经成功提交的恢复改报为失败。

## 2. 安全校验（RH-010）

| 校验 | 失败码 |
| --- | --- |
| 条目名逃逸导出根目录 / `..` / 盘符 / 反斜杠 | `unsafe_entry` |
| ZIP 损坏、重复条目、加密条目或非 Store/Deflate 压缩方法 | `bad_zip` |
| 条目数 > 200,000 | `too_many_entries` |
| 单文件解压 > 2GB | `file_too_large` |
| manifest/JSON metadata 单文件 > 64MB | `file_too_large` |
| 总解压 > 25GB（zip bomb） | `zip_bomb` |
| `exportVersion` 不在支持列表 | `unsupported_version` |
| manifest/JSON 损坏、引用缺失（未知 person/event/asset） | `bad_manifest` / `bad_json` / `bad_refs` |
| inbox 两个增量 JSON 只存在一个 | `missing_json` |
| 八份 1.1 Import/Portal/Review JSON 只存在一部分 | `missing_json` |
| 任何原件 SHA-256/字节数不符 | `hash_mismatch` |
| 目标实例已有家庭数据 | `target_not_empty` |
| operator 不存在、非 admin、已禁用或不是干净实例的未绑定 setup admin | `bad_operator` |
| manifest 中重复 assetId | `bad_manifest` |
| 家庭解锁年龄、guardian/child 组合或手工解锁时间非法 | `bad_policy` |
| Contribution visibility 不在白名单 | `bad_visibility` |
| Contribution 音频引用悬空或引用非音频原件 | `bad_audio_ref` |
| Transcript 引用未知 assetId 或 familyId 不一致 | `bad_refs` / `bad_json` |
| FactSource 引用未知 factId 或 sourceType 不在白名单 | `bad_refs` / `bad_json` |
| MemoryEvent tag 非字符串或长度非法 | `bad_json` |
| recorder Person/姓名快照/记录模式组合非法，或档案夹带本地 User id | `bad_provenance` |
| Import/Portal/Review 引用未知 session/person/asset/inbox/request/event/story | `bad_refs` |
| request 夹带 token/hash/User ID/live status | `bad_json` / `bad_provenance` |

限额可通过 `restoreFromZip(buffer, userId, { limits })` 注入（运维/测试用）。
CLI 的 `restoreFromZipFile` 先用 `stat` 执行压缩包本体上限检查，再由 yauzl 通过文件句柄
随机访问 Central Directory 与所需条目；它不调用 `readFileSync` 读取整个压缩包。

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

### 2.2 转录归档的完整性与旧档兼容

- 新导出必须包含 `transcripts.json`。旧的 `exportVersion: 1` 归档若不存在该文件，
  恢复端按空转录处理，仍可恢复。
- `transcripts.json` 存在时必须是数组。恢复端校验每行 ID 唯一、`familyId` 与 manifest
  一致、`assetId` 引用 manifest 中的原件、`status` 在 `machine|user_edited` 白名单内、
  `sourceSha256` 为 64 位十六进制、时间字段合法。
- 通过校验后，恢复按导出值原样写入 `rawTranscript`、`editedTranscript`、
  `segmentsJson`、`status` 与来源信息；提交前在同一事务内复核 `asset_transcript` 行数。

### 2.3 事实来源与事件标签的完整性与旧档兼容

- 新导出必须包含 `fact-sources.json`。旧的 `exportVersion: 1` 归档若不存在该文件，
  恢复端按空来源处理，仍可恢复。
- `fact-sources.json` 存在时必须是数组。恢复端校验每行 ID 唯一、`factId` 引用已知 fact、
  `sourceType` ∈ `asset | asset_analysis | contribution | transcript | user_text`；
  M3-D locator 字段 `quote`（可空字符串 ≤300）与 `startMs`/`endMs`
  （可空整数，0 ≤ start ≤ end ≤ 86,400,000）逐行校验，非法即拒绝整个归档。
  `facts.json` 中的事实、`sourceType` 在 `asset|contribution|transcript|user_text` 白名单内、
  `sourceId` 类型合法、时间字段合法。
- 通过校验后，恢复按导出值原样写入 `fact_source` 行；提交前在同一事务内复核
  `fact_source` 行数。
- 事件标签随 `memories.json` 的 `tags` 数组恢复为 `memory_event_tag` 关联行；提交前
  在同一事务内复核 `memory_event_tag` 行数。旧 `exportVersion: 1` 归档若事件无 `tags`
  字段，按空标签处理。

### 2.4 1.1 耐久关系图与 rc.4 兼容

- `import-sessions.json`、`import-session-default-participants.json`、
  `import-session-items.json`、`contribution-requests.json`、
  `contribution-request-submissions.json`、`contribution-portal-submissions.json`、
  `review-periods.json`、`review-period-events.json` 必须八份全有或全无。
- 真正的旧 v1/rc.4 文件集八份都缺失时按空关系恢复；Family 缺少周设置时采用周一开周、
  周日 19:30 和三类提醒开启的安全默认值。不会为旧数据补造 capturedAt 或其他事实。
- 当前 1.1 档案在任何原件写入前校验 session/item、默认 Person、最终 Asset/Inbox、
  request/submission、period/Story/Event 的完整关系。缺一份文件或一条引用即拒绝整个恢复。
- UploadSession 与临时文件不恢复；ImportSessionItem 的 `uploadSessionId=null`，已完成的
  Asset/Inbox 关系保持。ImportSession 创建者、published Story 发布者映射到 restore operator；
  其他不可迁移 User ID 置空。
- Contribution request/portal 的原 token/hash、创建/关闭 User 和 live status从不入档；
  每条恢复为 `status=closed`、`tokenHash=null`、`closedAt=restore time`。提交 bundle 与访客
  自填称呼保留，但入口绝不会意外继续有效。
- document 原件与图片/音视频执行同一字节数/SHA-256 校验、原子写入与二次导出验证。
- TXT/Markdown 的安全文本在恢复原件流中重新提取，并与素材关系同事务写入；不依赖备份中的派生文本。
  提取最多 256 Ki UTF-16 代码单元，仍检查后续全部字节的 UTF-8 有效性及 NUL；无效内容不建立文本预览/索引。
  PDF、Office、RTF、HTML/SVG 不走纯文本提取，原件保持不变。

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
- 家庭 `childLaterUnlockAge`、Person 的显式 `isGuardian` 与不可逆
  `childLaterUnlockedAt` 按归档值精确恢复；旧 v1 档案使用 18 / false / null 默认值。
- Family 周界和提醒偏好按归档值恢复；旧档使用 §2.4 的安全默认值。设备通知权限与调度 ID
  不恢复，用户仍需在每台设备上主动开启。
- Contribution 的 visibility、transcript、音频引用、recorder Person、姓名快照与记录模式
  原样恢复；旧实例的 `recordedByUserId` 不可迁移并始终恢复为 null。
- 恢复完成后：管理员登录 → `/onboarding` 自动检测「实例已有家庭」→
  显示绑定表单（选择自己是哪位成员；孩子档案不能作为登录身份）→
  `user.familyId / personId` 写入（`bindRestoredFamily`，服务端校验）。
- 时间线、事件、胶囊的完整性**不依赖任何 User 存在**（Person ≠ User）。

## 6. 测试

- `tests/integration/restore.test.ts`：A 建档（照片+音频+视频+文字+3 事件+讲述+事实+封存胶囊）
  → 导出 → 空实例 B setup → 文件句柄 restore → 全量比对（sha256/字节/occurredAt/关系/胶囊）；
  另覆盖不整包 `readFileSync`、文件路径哈希回滚/坏 ZIP，以及篡改哈希、坏版本、路径穿越、
  malformed manifest、解压限额、重复/加密/未知压缩方法、非空目标和坏 operator。
- `tests/roundtrip/restore-roundtrip.test.ts`（`npm run test:e2e` 末尾执行）：
  A 建档 → export → **销毁 A** → 干净 B → restore → **启动真实服务器** →
  登录 → 时间轴/详情核对 → 媒体字节+Range+401 → 导出 B → verify:export CLI 全绿。

1.1 增量覆盖还包括 document SHA、ImportSession/Item/default participant、request/portal
submission、ReviewPeriod/Event/Story source 的 A→B→二次导出往返；断言 token/hash 不进入
任一归档、恢复入口全部 closed，并验证八文件组缺一份时在写原件前失败。另用真实旧 v1 文件集
证明 rc.4 数据和周设置默认值可原地升级。

收件箱完整性的已实现验收覆盖：

- 导出集成：断言两个 inbox 文件与当前 manifest `fileCount`，逐行比对超过 100 字的
  待处理文字、待处理素材、`needs_review`、`discarded`、已确认文字及其素材关联。
- 恢复集成：逐项比对上述条目的 ID、状态、完整正文、`memoryEventId`、时间与关联行；验证
  两个文件都缺失的旧归档可恢复、只缺一个会拒绝，以及悬空 event/item/asset 引用会拒绝。
- 生产 roundtrip：A → export → 销毁 A → B restore → 真实服务器详情页仍能读取已确认文字
  的完整正文，且以无作者来源记录呈现，不产生虚构 Contribution 作者。

## 7. 未来迁移

- `exportVersion` 升级只做增量字段；恢复端对缺失字段取默认值
  （如 `type` 由目录推断、`timeSource` 按 capturedAt 推断、文件名回退 assetId.ext）。
- merge-into-existing、ID 重映射、增量导入均在 backlog，需先定义安全合并语义。

## 1.2 Collection 图

三文件模块全有或全无；manifest 声明 `modules.collections=1` 后缺一份或全缺均拒绝。
独立 verifier 与恢复预验共用纯图校验：同家庭、唯一 ID、字段白名单、日期/版本/排序、
Section/Item 所属、事件和原件引用、同册同来源去重、连续位置及容量边界。
校验在写任何原件前执行；三张表随同一恢复事务插入并逐表复核行数。

独立目录自动化验证真实生成的五份图片、两个相册、排序/手工说明、软删除来源、重启和
A→B→二次导出后逐行/原件 SHA 相等；缺模块、声明缺失、悬空来源在写原件前拒绝。
1.1 migration 前缀构造的独立 SQLite 文件可原地升级至 0036，WAL 一致快照保留；注入迁移失败
后旧数据/迁移账本回滚且连接释放。生产 Docker 卷与完整 1.1 原版导出验证仍以最终门禁记录为准。

1.2 MediaJob 是可再生处理状态，不进入 portable archive。继续只备份原件，预览/波形/转码
可在恢复并绑定人物后按需生成；独立目录测试核对原件 SHA，并验证重建预览 SHA 相同。

### 1.2 年册恢复

恢复与独立 verifier 共用 `lib/books/projects/portable.mjs`：六文件全有或全无，声明
`modules.bookProjects=1` 后缺文件即拒绝。预检验证人物/来源外键、同作品章/块/来源关系、
连续顺序、版式范围、历史版本号和快照来源身份；未知模块版本和坏关系在数据库写入前拒绝。
旧档没有年册模块时使用空数组。作品、章节、块、SourceRef、块来源、Revision 按 FK 顺序
在同一事务恢复并核对数量；私人 ownerPersonId 保持不变，需要按原有人物绑定流程认领。
删除标记保留，已失权或已删除来源不会因为恢复而显示。原始文件 SHA 与二次导出的编辑图
必须一致。测试使用独立目录；不据此代称实际旧用户卷或手机升级已经完成。
