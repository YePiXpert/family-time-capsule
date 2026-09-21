# 桉桉成长记 · Build 72「家人一起写」实施计划（落款 + 多机同步）

> 2026-09-21 起草，同日主人批准并拍板第七节四条（自动同步默认开；冲突新者胜加留底；「从远端恢复」去掉；那半句用「入淮清洛渐漫漫」，整句诗进扉页，可选提交 15 一起做）。从提交 1 开始，服务端先部署再出手机包。
> 依据：PRODUCT.md 第四节原则 3「谁写的，和写了什么一样重要」、第八节次序 1；主人同日拍板：落款用关系称呼（爸爸／妈妈／外婆…），不用账号名；1 与 2 都做，先 72 后 73「说一段」。
> 她叫李清洛，小名桉桉，名字取自苏轼「入淮清洛渐漫漫，人间有味是清欢」——本计划末尾有一个可整体划掉的可选提交，把本名与这句诗放进扉页。

## 一、Context

- 现状：记录（`RecordContent`）没有「谁写的」，只有信有 `from`；远端备份是**每个成员一份**（`backup_manifests(member_id PK)`、对象在 `<root>/<memberId>/objects/`），每台手机自己生成钥匙（12 词恢复码），`restoreFromRemote` 是整库替换。家人各有账号（Build 67），账号只管登录与 AI 额度。
- 目标：妈妈、外婆的手机也能写，每段时光都有落款，几台手机看到的是同一本册子；离线照常记，联网时合并；照片只传缺的。
- 不做：实时协作、云端搜索、第三方云盘、人脸识别、真地图足迹、给不装 App 的人看的网页（PRODUCT.md 第六节）。
- 纪律不变：只在 main 小提交直推；每次推送前 mobile 三件套（`TMPDIR=/var/tmp/anan-tests npm test`、`typecheck`、`lint`）+ server 两件套 + `python3 mobile/scripts/verify-local-boundary.py` + `python3 -m unittest discover -s mobile/scripts -p 'test_*.py'` 全绿；构建号只在收尾提交里改；UI 只用 `mobile/src/local/ui.tsx` 的基元并同步 DESIGN.md；改 `Library` 就要一次接全（ENTITY_KINDS／emptyLibrary／normalizeLibrary／forkLibrary／validEntity／referencedMedia／`local_fixture.py`）。

## 二、开工时要确认的环境事实

- 生产服务端 = `81d1ffe`（HANDOFF 第一节），数据在 `/opt/anan-ai/data`（含 `backup/` 对象库，UID 1000）。提交 3 部署前先 `cp -a /opt/anan-ai/data /opt/anan-ai/data.bak-<时间>`：这一版会把成员目录里的对象搬进家庭目录。
- 主人手机（Build 71）已开远端备份：它的钥匙就是**全家的钥匙**。其他手机加入时输入这份恢复码；已经自己开过远端备份的手机（另一把钥匙）加入时，旧备份留在服务上，可事后由主人删除。
- 服务端 `auth()` 返回的成员带 `deviceId`（devices 表主键）：清单可以按设备存，Build 71 的客户端不用改也能被正确归到自己的设备上。
- vitest 的 expo-file-system 假件以 `env.root` 为文档根：两台「手机」= 切换 `env.root` 后 `vi.resetModules()` 再动态 import 一套模块。

## 三、设计定稿

1. **落款是关系称呼**：`RecordContent.by?: string`（trim 后 1～20 字；空或缺省 = 没落款，旧记录都这样）。这台手机的默认落款放 `settings.by`（`settings` 是设备本地根字段，不同步），新草稿 `content.by = settings.by`，编辑旧记录保留原落款。信的 `from` 不改名不合并（它本来就是落款）。
2. **一台服务 = 一家人**：对象库合成一个家庭空间 `<root>/family/objects/`；清单按**设备**存（`backup_manifests_v2(device_id PK, member_id, key_id, index_b64, updated_at, objects_json)`）。配额按家庭算，上限取主人的 `backup_limit_bytes`；prune 的 keep = 全部设备清单登记对象的并集 ∪ 客户端 keep。旧路由语义照旧、对 Build 71 兼容（见提交 1）。
3. **每台手机发布自己的全量清单，拉别人的清单做三方合并**。清单就是现在的 `.xmbm`（`createBackup` 产出），不发明新格式。合并时以「上次同步后我见过的版本」为基（`sync/base.json`：每个实体一枚指纹 `updatedAt|sha256(JSON)`），删除靠墓碑（`Library.tombstones?: Record<"kind:id", deletedAt>`，根字段、随备份走、不进归档）。
4. **哪些同步，哪些不同步**：同步 records、media、albums、series、persons、letters 与根字段 profile／yearNotes／yearCovers／yearBooksBoundAt／tombstones；**不**同步 drafts、selections、settings、receivedShares、nudgeClosedAt、lastExportAt、welcome、revision。别人清单里的草稿看都不看。
5. **合并规则**（`merge.ts` 纯函数，逐实体）：
   - 本机没变（= 基）→ 取远端；远端没变 → 留本机；两边都变 → 按 `updatedAt` 新者胜（同秒比内容哈希），输的一版存进本机 `sync/conflicts.json`（标题、正文、落款、日期、来自哪台设备），书架出一张「两台手机都改过」卡，可「用这一版」（作为新一版重新保存）或「知道了」。**不弹窗、不丢字。**
   - 墓碑：`deletedAt` 晚于实体 `updatedAt` → 删；实体在墓碑之后又被改过 → 改者胜、墓碑作废（写的人比删的人重要）。墓碑只写 records／albums／series／letters／persons 的删除（`deleteRecord`、`deleteLetter`、相册／系列删除、`deletePerson`、`mergePersons` 的 source），永不清理（一条一行，删除本来就少）。
   - media：按 id 取并集，本机已有的**永不**被远端覆盖（thumb、width/height 是本机产物）；只物化被合并后的共享实体引用到的素材，只被别人草稿引用的不下。
   - albums／series：`name`／`note` 按 LWW，`items` 取并集（基的顺序在前、新增在后）；persons 同名自动合并（`mergePersons`）。
   - 根字段：profile、yearNotes（按年）、yearCovers（按年）、yearBooksBoundAt（按年取早）以「与基不同的那一方」为准，两方都不同时取 createdAt 新的清单。
   **实施修订（提交 9，2026-09-21）**：别人的清单是整库快照，输掉的旧版会一直躺在里面，光有「上次同步的指纹」会把它当成新改动送回来。所以基多记一份 `known`（每个实体本机处理过的全部版本：曾持有、曾判输、曾判过时，每实体最多 32 枚），远端版本与本机相同、与基相同或已认得的一律不看。此外：本机没动而远端那版比本机还旧（对方恢复了旧备份、时钟不准）→ 留本机、出冲突卡而不是倒退；同秒、以及没有时间的根字段与人物，按内容哈希定赢家（两台手机得出同一个）；年度寄语两边都改则两段都留（赢家在前）；相册／系列并集有新增时盖上合并时刻，免得两台各执一版；系列里同一条记录只留一处；`revision` 不进指纹（它只是本机草稿的防撞计数，接别人的版本时在本机原值上加一）。冲突留底只记 records／letters，另一方是删除时 `winner.deleted = true`。
6. **一次同步**（`family.ts` 的 `runFamilySync`）：核对钥匙 → `GET /backup/manifests` → 跳过 sha 没变的设备（`sync/state.json` 的 `seen`）→ 逐份下载解密清单 → `merge` → 先把缺的素材逐个下载进 blob 库（写一枚 `restoring-*.xmbm.part` 钉子保护，可停可续）→ 物化到 media 目录并生成缩略图 → **一次** `store.change` 写入合并结果 → `createBackup` 出新清单 → 只传缺的对象 → `PUT /backup/manifest`（服务端按设备存）→ `prune` → 写 base／seen／state。任何一步失败，本机库一个字节没动（与 `restoreBackup` 同一哲学）。
7. **加入与退出**：备份页最后一张卡由「远端备份」改为「家人一起写」（testID 仍是 `remote-card`，未登录仍只有「去登录」）。已登录未加入：服务上有别人的清单 → 「加入」（输入 12 词恢复码 → 首次同步 = 合并而不是替换，本机已有的内容会一起推上去）；服务上是空的 → 「开始一起写」（生成钥匙 → 抄恢复码 → 首次推送）。已加入：「现在同步」+ 一行「上次同步 9月21日 14:02 · 3 台手机 · 1.2 GB」+ 文字级「查看恢复码」「验证」「退出（本机资料留着）」；主人多一个危险文字「删除远端全部」。「从远端恢复」（整库替换）**去掉**：换机就是「加入」，空库合并等于全量拉取，一条路够了（主人：精简且强大）。`engine.ts` 的 `restoreFromRemote` 与 `RecoveryCode` 的恢复态一并删除。
8. **自动同步**：登录且已加入时，回到前台、保存一段时光后 30 秒（防抖）自动跑一次，静默失败只记 `lastError`，进度与结果写在「我的 → 备份与恢复」行的副题上（「上次同步 …」／「有 2 段两台手机都改过」）。宪法禁 `expo-network`，分不出 Wi‑Fi，照片一起下；「外观设置」里给一个「回到应用时自动同步」开关（默认开）。
9. **老记录补落款**：升级后书架出一张卡（提醒种类 `by`，排在里程碑之前、冲突之后）：「以前的 N 段时光还没有落款，都是{默认落款}写的吗？」→ 「都是」一键写上 ／ 「不用了」永久关闭。逐条也能在编辑页改。
10. **旧版兼容**：Build 71 能打开 Build 72 的备份（`by`、`tombstones` 都是可选字段，校验不拒绝未知键），只是看不到落款；Build 71 手机的远端备份继续可用（清单归到它的设备名下）。服务端不能回退到本版之前（家庭空间已迁移）。

## 四、提交清单（16 个，全部在 main；1–3 服务端先行）

### 服务端

**提交 1 · 家庭对象空间与设备清单**
- `server/src/backup-store.ts`：`memberDir(memberId)` → `spaceDir()` 固定 `<root>/family/objects`，所有方法去掉 `memberId` 参数（保留同名签名的薄兼容层不值得，一次改干净）；新增 `migrateMemberSpaces()`：把 `<root>/<uuid>/objects/xx/<id>` 逐个 `rename` 进家庭目录（同 id 已存在就删源文件），空目录删掉；启动时在 `sweepTemp(0)` 之后调用。
- `server/src/store.ts`：建 `backup_manifests_v2(device_id TEXT PK, member_id TEXT NOT NULL REFERENCES members(id), key_id, index_b64, updated_at, objects_json)`；启动迁移把旧表每行插成 `device_id = 'legacy:' || member_id`，旧表保留不再写。`putManifest(deviceId, memberId, keyId, index, objects)`（同时 `DELETE ... WHERE device_id = 'legacy:'||memberId`）、`manifestOf(deviceId)`、`latestManifestOf(memberId)`（含 legacy）、`manifests()`（全部，带 devices.name）、`deleteManifest(deviceId)`、`manifestObjects()`（全部 objects 并集）。
- `server/src/app.ts`：`PUT /backup/manifest` 按 `member.deviceId` 存；`GET /backup/manifest`（旧）→ 本设备的，没有则本成员最新的（含 legacy），再没有 404；新增 `GET /backup/manifests` → `[{deviceId, memberId, deviceName, keyId, index, updatedAt}]`；`DELETE /backup/manifests/:deviceId`（自己的任一设备，或主人任意）；`DELETE /backup`（旧）→ 只删本成员的清单行（对象留给 prune）；`POST /backup/prune` keep ∪ `manifestObjects()`；`have`／`put`／`get` 走家庭空间。
- 测试 `server/tests/backup.test.ts`：迁移（两成员各两对象 + 一个重复 id → 家庭目录 3 个对象、成员目录消失、旧清单行变 legacy）；设备清单增删查；旧 GET 的三段回退；prune 只删「所有清单都不引用」的；Build 71 形状的 PUT（不带 objects）照常。

**提交 2 · 家庭配额、状态、管理端与验证脚本**
- `app.ts`：`GET /backup/status` → `{keyId: 最新清单的, manifestUpdatedAt, objects, bytes, limitBytes: 主人的 backup_limit_bytes, freeBytes, manifests: n}`；上传配额按家庭用量 × 主人上限；`DELETE /admin/backup`（主人清空家庭空间：先删全部清单行再 `wipe()`）；`GET /admin/overview` 的 `backup` 改为家庭一份 + 各设备清单时间；`PATCH /admin/members/:id` 的 `backupLimitBytes` 只对主人自己有意义（文档说明）。
- `server/src/manage.ts wipe-backup` 不再按成员，改为清空家庭空间（要求输入 `family` 确认字）。
- `server/scripts/verify-service.py` 备份段跟上：两个成员上传各自对象后 `status.objects` 是家庭总数、`manifests` 列出两台、旧 GET 回退、admin wipe；`deploy/README.md` 「远端备份对象库」一节改写为家庭空间（迁移、配额、删除语义、**部署前先 cp 一份 data**）。
- 测试：配额跨成员共享（甲传满乙也 413）、admin wipe、overview 形状。

**提交 3 · 部署**
- staging 3141 跑 `verify-service.py` 全绿 → `cp -a /opt/anan-ai/data …bak` → 切 SOURCE_SHA → `/healthz` 核对 → 用 Build 71 手机做一次「现在备份」确认兼容。HANDOFF 第一节记 SHA。

### 手机 · 落款

**提交 4 · 模型与墓碑**
- `model.ts`：`RecordContent.by?: string`（`BY_LIMIT = 20`）；`Library.settings.by?: string`；`Library.tombstones?: Record<string, string>`；`normalizeLibrary` 不必补默认（都是可选）；`validContent` 加 `by` 校验（缺省或 1～20 字的非空 trim 字符串）；`validRoot` 加 `settings.by`、`tombstones`（键 `^(records|albums|series|letters|persons):[a-zA-Z0-9_-]{1,128}$`，值可解析的时间）；`rootOf`／`forkLibrary` 带上 `tombstones`；新增 `tombstone(s, kind, id, now)`，在 `deleteRecord`、`deletePerson`、`mergePersons`（source）里落墓碑，`services.deleteLetter`、相册与系列的删除处（`Albums.tsx`／`Series.tsx` 调用的 change）改走新的 `deleteAlbum`／`deleteSeries` 服务函数并落墓碑。
- `services.beginDraft`：新草稿 `content.by = s.settings.by ?? ""`（空则不写键）；`saveRecord` 照常复制。
- `scripts/local_fixture.py` 的 `empty()` 不变（新键都可选），`record()` 加 `by='爸爸'` 供冒烟；`tests/local-core.test.ts` 补：墓碑写入、`by` 校验正反例、备份往返带 `tombstones`。

**提交 5 · 编辑页落款**
- `Editor.tsx`：正文框下那行「草稿会自动保留」右侧加文字级 `SignatureButton`（新基元，`ui.tsx`）：显示「—— 爸爸」，没落款显示「谁写的？」；点开就地展开一行 chips：本库出现过的落款（按使用次数）∪ 预设「爸爸／妈妈／外婆／外公／奶奶／爷爷」∪「其他…」（就地输入，20 字）；选中即写入 `draft.content.by`，并在 `settings.by` 为空时顺手设为默认（「以后这台手机默认落款：爸爸」一行小字，带「改」）。分组模式下每件事共用同一个落款。testID `editor-by`、`editor-by-<称呼>`。
- DESIGN.md「编辑」条加：落款行的位置、chips 规则、「写关于她的用她」不变（落款是称呼不是句子）。
- 测试 `services.test.ts`：新草稿默认落款；编辑旧记录不改落款。

**提交 6 · 落款进阅读页、纪念卡、纸书、归档、搜索**
- `Record.tsx`：正文之后右对齐一行辅助色衬线「—— 爸爸」（testID `record-by`）。`KeepSakeCard.tsx` 两处正文下同一行；`book.ts`／`BookPage.tsx` 每条记录文字后加落款（小号、右对齐），`yearbook.ts` 长图不加（版面已满）。
- `archive-layout.ts` 记录 front matter 加 `["落款", r.by]`；`ArchiveRecord.by`；`archive-viewer.ts` 记录卡末尾 `—— 爸爸`。
- `search.ts`：`recordMatches` 支持 `by` 过滤；`SearchScreen.tsx` 出现过 ≥ 2 种落款时加一组「谁写的」chips（最多 6 个）。
- `Year.tsx`／`recap.ts`：统计行下一行「爸爸 42 段 · 妈妈 31 段 · 外婆 6 段」（只在有落款时出现；`recap.ts` 纯函数 `byCounts`）。
- 测试：keepsake、book（元素不越界）、archive-layout／viewer、search、recap 各补一例。

**提交 7 · 我的落款与补落款卡**
- `Settings.tsx`「我的」加一行「我的落款」（副题「爸爸」／「还没设」）→ 页内同一套 chips + 「其他…」。
- `nudge.ts`：`NudgeKind` 加 `"conflict" | "by"`，`NUDGE_ORDER = ["conflict","by","milestone","book","backup","rhythm"]`；`nudgeClosed("by")` 关过即永久。`Shelf.tsx`：`by` 卡文案「以前的 N 段时光还没有落款，都是{by}写的吗？」按钮「都是」（一次 change 给所有无落款记录写 `by`，`revision+1`）／✕ 永久关闭；没设默认落款时按钮改为「去设落款」。
- 测试 `nudge.test.ts`：顺序与永久关闭；`services.test.ts`：批量补落款只动没落款的。

### 手机 · 同步

**提交 8 · 传输层与本机状态**
- `transport.ts`：`Transport` 加 `manifests(signal)`、`deleteManifest(deviceId, signal)`、`wipeFamily(signal)`（主人）；`RemoteStatus` 加 `manifests: number`。
- `state.ts`：`RemoteState` 升 `version: 2`（`enabled`、`keyId`、`joinedAt`、`lastSyncAt`、`lastSyncSummary: {devices, objects, bytes, pulled, pushed, conflicts}`、`seen: Record<deviceId, sha256>`、`lastError`、`autoSync: boolean`），v1 读入即升级；新增 `readBase()`／`writeBase()`（`sync/base.json`：`{merged: Record<kind, Record<id, fingerprint>>, known: Record<"kind:id", fingerprint[]>}`——`known` 是每个实体本机已经处理过的其他版本，见第三节第 5 条的实施修订），`readConflicts()`／`writeConflicts()`（`sync/conflicts.json`），都是 `.part` + `moveSync`。（已做：2026-09-21）
- 测试 `sync-transport.test.ts`、新 `sync-state.test.ts`：v1→v2 升级、坏文件归零、原子写。

**提交 9 · 合并（纯函数）**
- `src/sync/merge.ts`：`fingerprintOf(entity)`、`mergeLibraries(local, remotes: {library, createdAt, deviceId}[], base): {next: Library, conflicts: Conflict[], wantedMedia: LocalMedia[], base: Base}`，按第三节第 5 条逐条实现；`applyTombstones`；`unifyPersons`（同名合并复用 `mergePersons`）；`unionItems`。
- `tests/sync-merge.test.ts` ≥ 25 例（已做：36 例，2026-09-21）：单边改、双边改（LWW + 冲突留底、同秒比哈希）、删 vs 改、删 vs 没改、双删、相册两边各加一条、系列同月两边各选一张（LWW）、同名人物合并且记录标记改写、只被别人草稿引用的素材不物化、根字段各情形、空基（首次加入）退化为 LWW 且不误报冲突（内容相同不算冲突）、幂等（合并两次结果相同）。

**提交 10 · 同步引擎**
- `src/sync/family.ts`：`runFamilySync(store, deps)`（第三节第 6 条的流程；复用 `engine.ts` 的 `fetchManifest`→ 抽成 `fetchManifestOf(entry)`、`downloadContent`、`uploadContent`、`runRemoteBackup` 的推送段抽成 `pushManifest(state, deps)`）；`joinFamily(store, key, deps)` = 校验 keyId 与服务上最新清单一致 → `storeKey` → `runFamilySync`；`leaveFamily()` = 删本机钥匙与 state／base／conflicts、`deleteManifest(本设备)`，本机资料不动；`materialize(media)`：blob → media 目录（`mediaFile` 名沿用远端）→ `renderThumb`。`engine.ts` 的 `restoreFromRemote` 删除（换机 = 加入）。
- 停止与续传：钉子文件复用 `restorePinName`；`collectBlobs` 已认钉子；中断后下一次同步从缺的 blob 接着下。
- 测试 `sync-family.test.ts`（假传输 + 假文件系统）：首次加入拉全量、第二次只拉变了的设备、推送只传缺的、中断续传、写库失败时本机不变、退出不删资料。

**提交 11 · 界面：家人一起写卡、冲突页、加入流程**
- `src/sync/FamilyCard.tsx` 取代 `RemoteBackupCard.tsx`（文件改名，testID `remote-card`／`remote-backup` 等保留给冒烟）：第三节第 7 条的三态；「加入」进 `RecoveryCode` 的 enter 态（加 `mode: "join"`，主按钮「加入并同步」，进度行复用）；「开始一起写」= 现在的 `enable`。`Settings.tsx` 备份页调用处改名。
- `src/sync/Conflicts.tsx`：列表卡（日期、标题、两版落款与时间、输的一版全文）+ 「用这一版」（`saveRecord` 新一版，`by`／`date` 沿用输的一版）+ 「知道了」；空态一句。`App.tsx` 注册路由 `Conflicts`。
- `local/context.tsx`：`SyncStatusContext`（纯类型 `{lastSyncAt?, conflicts: number, running: boolean}`，不 import sync）；`App.tsx` 提供值。`Shelf.tsx` 用它出 `conflict` 卡（「有 N 段两台手机都改过」→ 进 Conflicts）。`Settings.tsx`「备份与恢复」副题：「上次同步 9月21日 14:02」／「有 2 段两台手机都改过」。
- DESIGN.md：备份页「远端备份」卡改写为「家人一起写」卡三态与文案；冲突页；书架 `conflict`／`by` 两种提醒卡；外观页开关。

**提交 12 · 自动同步**
- `src/sync/auto.ts`：`useAutoSync(store, enabled)`——`AppState` 回前台 + 订阅 `store.subscribe` 里记录数变化后 30 秒防抖；同一时刻只跑一个；失败写 `lastError`，不弹窗。只在 `App.tsx` 里用。`Appearance` 页加「回到应用时自动同步」开关（写 `RemoteState.autoSync`，不进 Library）。
- 测试：防抖与互斥（假 timers）。

**提交 13 · 端到端与冒烟**
- `tests/sync-e2e.test.ts` 加一例「两台手机」：A 建库、开始一起写、写两段（落款爸爸）→ 切 `env.root` 重新 import 一套模块当 B → B 用 A 的恢复码加入 → 有 A 的两段 → B 写一段（妈妈）、删 A 的一段 → 同步 → 切回 A 同步 → A 多一段少一段、落款正确、blob 只多不重传；再各改同一段 → 冲突留底一条。
- `smoke-android.py`／iOS 回归：编辑页点 `editor-by-爸爸` → 阅读页 `record-by` 文本「—— 爸爸」；备份页仍断言 `remote-card` 只有「去登录」。
- `scripts/test_local_boundary.py` 不变；`local_boundary.py` 新增一条：`src/local/**` 只有 `App.tsx`、`Settings.tsx` 可 import `../sync/`——已有；补断言 `src/sync/**` 不得 import `../local/*.tsx`（界面单向依赖），带测试。

**提交 14 · 收尾**
- CHANGELOG「Build 72 — 家人一起写」逐条；README「使用」加落款与一起写两段、「数据与结构」加墓碑与同步目录；HANDOFF 第一节／恢复提示词／第四节；DESIGN 已随各提交；`mobile/app.json` 72（定点改 `\uXXXX`）。派发 `mobile-build.yml`（完整 SHA）→ 校验和记 HANDOFF。

### 可选（可整体划掉）

**提交 15 · 扉页：本名与名字的来历**
- `profile.fullName?: string`（本名，如「李清洛」）、`profile.motto?: string`（名字的来历一句，如「入淮清洛渐漫漫，人间有味是清欢」，≤ 60 字）；`Profile` 页两个输入；扉页（`TitlePage`）名字下一行「李清洛 · 小名桉桉」、再一行衬线辅助色的诗；纸书扉页（`book.ts` `titlePage`）同款；归档 `index.html` 头部同款。两个字段随备份与同步走（profile 是共享根）。
- 「我的」页 App 名后那半句：建议改为「入淮清洛渐漫漫」（藏着她的名字；下半句太多人用过，反倒俗了）。主人另选也只改 `Settings.tsx` 一行。

## 五、验收（真机，主人两台手机 + 一台家人的）

1. 主人手机升 72：书架出「补落款」卡 → 「都是 爸爸」→ 旧记录阅读页有「—— 爸爸」；新写一段默认落款爸爸，可切成妈妈。
2. 妈妈手机装 72、登录自己的账号 → 备份页「加入」→ 输主人的恢复码 → 进度 → 书架出现全部记录与照片，落款正确；她写一段（妈妈）→ 主人手机回前台自动同步后看到。
3. 两台各改同一段 → 两边都保留时间新的一版，书架各有一张冲突卡 → 「用这一版」能换回。
4. 妈妈删一段 → 主人同步后消失；主人先改过那段再同步 → 不消失、且冲突卡说明。
5. 飞行模式下照常记、照常看；恢复网络回前台自动补同步。
6. 外婆手机（安卓）从空库加入：第一次拉全量有进度、可停、再来续传。
7. 主人「我的 → AI 设置」管理页看到家庭用量与三台设备的清单时间；`DELETE /admin/backup` 只在主人确认后。
8. 导出 `.xmb` → 在旧 Build 71 上恢复能打开（看不到落款）；开放归档的 Markdown 有「落款」行，`index.html` 显示「—— 妈妈」。
9. 双端冒烟全绿；`verify-service.py` 全绿；mobile 测试 ≥ 380、server ≥ 45。

## 六、风险与对策

- **首次加入下载全部照片**（可能几 GB、蜂窝网络）：进度逐张、可停可续（blob 库 + 钉子）；文案提醒「建议连 Wi‑Fi」（分不出网络类型是宪法的取舍）。
- **时钟偏差让 LWW 选错**：输的一版永远留底可换回；不引入向量时钟。
- **服务端迁移搬目录**：同一文件系统内 rename；部署前 `cp -a` 整个 data；迁移幂等（再跑一次无事发生）。
- **Build 71 手机在迁移后继续备份**：清单归到它的设备名下，升级后首次同步自然并入；legacy 行在该成员任一设备 PUT 后删除。
- **补落款误标**：只动没有落款的记录，且逐条可改；卡可永久关闭。
- **草稿不同步**造成「妈妈手机上写了一半的东西主人看不到」：这是刻意的（PRODUCT 原则 7：草稿是这台手机的事），文案在加入页说明一句。

## 七、主人拍板（2026-09-21）

1. 自动同步**默认开**（回前台 + 保存后 30 秒），照片一起下。
2. 两台都改同一段：时间新者胜 + 留底可换回，**不弹窗**。
3. 「从远端恢复」**去掉**，换机就是加入（精简且强大）。
4. 那半句话用「**入淮清洛渐漫漫**」；整句诗与本名进扉页，可选提交 15 **做**。
