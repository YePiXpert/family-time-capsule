# 导出格式（EXPORT_FORMAT）

> 本文档定义 `GET /api/export` 产出的 ZIP 结构（Issue #014 实现）与兼容性承诺。
> 恢复流程见 [RESTORE.md](./RESTORE.md)。离开本系统后，ZIP 内的媒体、
> Markdown、JSON 都必须可直接打开/解析（PRD §18）。

## 版本

- 当前 `exportVersion: 1`。
- **兼容承诺**：未来版本只做增量演进——新增字段不删旧字段、不改变既有字段语义；
  任何 `exportVersion: 1` 的导出永远可以被当时的 `verify:export` 校验、
  并被「同大版本」的恢复工具读取。重大不兼容变更将提升主版本号并提供迁移说明。

## 目录结构

```text
family-time-capsule-export/
├── manifest.json          导出清单与每个原件的哈希（见下）
├── family.json            家庭元信息（单对象）
├── people.json            Person 数组（现实家庭成员，含无账号者）
├── memories.json          MemoryEvent 数组（含 assetIds / participantPersonIds 关系）
├── inbox-items.json       InboxItem 全量数组（含所有状态与完整原始文字）
├── inbox-item-assets.json InboxItem ↔ Asset 关联行全量数组
├── contributions.json     Contribution 数组（按家人的独立讲述）
├── facts.json             Fact 数组（已确认/否决的事实）
├── capsules.json          Capsule 数组（含封存胶囊的完整内容引用）
├── timeline.md            人类可读时间轴（相对路径引用原媒体）
├── originals/
│   ├── images/            <assetId>.<ext>
│   ├── audio/
│   ├── video/
│   └── documents/
└── stories/               P1 起存放生成的章节；P0 为空
```

空目录以 `.keep` 占位，保证「没有内容的目录也存在」。

## manifest.json

```jsonc
{
  "exportVersion": 1,
  "appVersion": "0.1.0",          // 产生导出的应用版本（package.json version）
  "exportedAt": "2026-08-29T12:00:00.000Z",
  "familyId": "<uuid>",
  "familyName": "我们一家",
  "fileCount": 17,                 // 固定 10 个非媒体文件 + 7 个原件（不含 .keep）
  "assetCount": 7,
  "assets": [
    {
      "assetId": "<uuid>",
      "relativePath": "originals/images/<uuid>.jpg",
      "sha256": "<hex>",
      "bytes": 123456,
      "mimeType": "image/jpeg",
      "capturedAt": "2026-08-10T01:30:00.000Z",  // null = 未知
      "importedAt": "2026-08-29T04:00:00.000Z",
      // ↓ v0.1.1 增量字段（exportVersion 仍为 1；旧导出缺失时恢复端取默认值）
      "type": "image",
      "originalFilename": "IMG_0001.HEIC",
      "timeSource": "embedded_metadata",
      "width": 4032,
      "height": 3024,
      "durationMs": null,
      "metadataJson": "{...}"        // EXIF/ffprobe 快照原样带回
    }
  ]
}
```

规则：

- `assets` 只包含**原件**（derivativeType=null）；衍生物可再生，不入档。
- 当前格式固定包含 10 个非媒体文件：manifest、family、people、memories、
  inbox-items、inbox-item-assets、contributions、facts、capsules、timeline；因此
  `fileCount = assetCount + 10`，`.keep` 不计数。
- `capturedAt`/`importedAt` 为 UTC ISO-8601。
- 增量字段缺失时的恢复端默认：`type` 按目录名（images/audio/video/documents）推断；
  `timeSource` 按 capturedAt 有无推断（有→embedded_metadata，无→import_time）；
  `originalFilename` 回退 `<assetId>.<ext>`。

## 实体 JSON 语义

- `family.json`：`{ id, name, timezone, createdAt, updatedAt }`。
- `people.json`：`{ id, displayName, relationToChild, isChild, birthDate(YYYY-MM-DD|null), createdAt }`。
  `id` 即 `personId`，被 memories/contributions 引用。
- `memories.json`：按 `occurredAt` 升序；每个事件含
  `assetIds: string[]` 与 `participantPersonIds: string[]`（关系以数组表达，
  对应库内关联表，不丢结构）。
- `inbox-items.json`：`{ id, familyId, kind, status, rawText, memoryEventId, createdAt, updatedAt }`。
  导出家庭下的**每一行**，不按状态过滤；`status` 原样保留 `new`（待处理）、
  `processing`、`needs_review`、`confirmed`、`discarded`，`rawText` 保留完整正文，
  不做 100 字截断。`memoryEventId` 可为 `null`；确认或合并后的条目用它指向消费该条目的
  MemoryEvent。
- `inbox-item-assets.json`：`{ id, inboxItemId, assetId, familyId, createdAt }`。
  导出家庭下的**每一条关联行**，包括仍待处理、需复核、已确认或已丢弃条目的素材关系；
  行 ID 与两端引用均原样保留。
- `contributions.json`：`{ id, memoryEventId, authorPersonId, rawText, editedText, audioAssetId, visibility, createdAt }`。
- `facts.json`：`{ id, memoryEventId, statement, status, createdAt }`。
- `capsules.json`：`{ id, title, unlockType, unlockValue, status, sealedAt, openedAt,
  memoryEventIds, assetIds, contributionIds }`。**无论是否到期/封存，内容引用始终完整**——
  封存是 UI 仪式，不是加密（PRD §15）。

确认文字条目的正文仍属于 `inbox-items.json`，并通过可空的 `memoryEventId` 关联到事件。
事件详情把这些 `rawText` 显示为**无作者的原始文字记录**；系统不会为了显示正文而虚构
Contribution 或讲述者。合并到同一事件的多条文字也各自保留为独立行。

### 收件箱文件的增量兼容

- 当前导出始终同时写入 `inbox-items.json` 与 `inbox-item-assets.json`，即使数组为空。
- 两个文件是在 `exportVersion: 1` 上的增量扩展。较早的 v1 归档可能两者都不存在；恢复端
  将其解释为“空收件箱”，仍可恢复。
- 若归档只缺其中一个文件，条目与素材关系可能不完整，恢复端会拒绝，而不会静默丢行。

## timeline.md

- 一级标题 = 家庭名；按家庭时区年月分组；事件含日期、孩子年龄（由
  `people.json` 的 child `birthDate` 现算）、参与人。
- 媒体引用一律是**相对路径**（`originals/images/xxx.jpg`），解压后在本目录内有效。
- 图片内联为 Markdown 图片；音频/视频为链接（Markdown 阅读器外直接双击文件播放）。

## 校验

- 导出时：服务端**重读磁盘重算 SHA-256** 并与数据库比对，不符则整个导出失败（HTTP 409）。
- 导出后：`npm run verify:export <zip路径>` 独立校验 manifest 与 ZIP 内容（见 RESTORE.md）。
