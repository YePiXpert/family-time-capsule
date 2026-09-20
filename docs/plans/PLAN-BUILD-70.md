# 桉桉成长记 · Build 70「传家 · 中」资料不灭 · 实施计划

> 2026-09-20 开工时由 `docs/plans/PLAN-BUILD-69.md` 第二部分展开。约束清单 1–34 与提交概要原文留在那里，本文件只写每个提交要动的文件、函数签名、测试清单与验收。主人已拍板：一个安装包含 A 本机 blob 备份库、B `.xmb` 分卷、C 加密远端备份（含远端恢复）、D 宪法修订；**恢复码即密钥**（12 词 BIP39，无口令、无 scrypt）；VPS 可用磁盘 50–200 GB；手机资料 < 5 GB。

> **实施偏离（2026-09-20 收尾时记）**：
> 1. 提交 4–6 与 8–10 各合成一个提交（本机 blob 库 22a889e；分卷导出 + 备份页 b1082ca）：没有拼卷器时备份页的「导出」会把 `.xmbm` 当整包分享，不能留这种中间态在 main 上。
> 2. `local_fixture.seed` 没有预置 `.xmbm`——它会排在 v1 的 `baseline.xmb` 前面，把 iOS 冒烟「恢复这份备份」验的旧格式路径挤掉；改为核对 App 自己写出的 `.xmbm` 与 blob（`check_blob_store`）。
> 3. 计划外修了一个旧 bug：恢复最旧的那份保留备份时，`restoreBackup` 先做的「备份当前内容」会把它 prune 掉；现在恢复期间保护输入文件，恢复完再按常规留三份。
> 4. 清单对象与清单索引的 nonce／id 也按内容派生（清单全文 sha256、索引明文 sha256 + 钥匙），全程没有随机 nonce；`sealSmall` 的格式是 `ANANSML1 ‖ nonce ‖ 密文`。
> 5. 传输层 `missing`（have）每 2000 个一批；对象总数超过 50000 时本轮不 prune。
> 6. 「保留远端，只关闭」保留钥匙，重新开启复用同一把（恢复码不变）；「从远端恢复」成功后这台手机采用该钥匙并开启远端备份。
> 7. 服务端（提交 11–12）先于手机端部署到生产（6672e66），旧版 App 不受影响；反代匿名探过 0.5／4／9／16 MB 全部直达服务。
> 8. 提交 21（`release_tag` → GitHub Release）没有做。

## 一、开工时确认的环境事实

- 开发机就是 VPS（hostname `gateway`）：`anan-ai-ai-1` 容器镜像 `anan-ai:9bd192a…`，`/opt/anan-ai/data` 即容器内 `/data`（UID 1000），磁盘 296 GB／可用 238 GB；`server/` 与 `deploy/` 自 9bd192a 起没有改动。部署就是 `deploy/README.md` 那一条 compose 命令，在本仓库目录执行；`deploy/backup.sh` 也 `cd` 到本仓库。
- 公网 HTTPS 反代**不在这台机上**（1panel openresty 里没有 capsule.yep.li 的站点配置），上限仍按「未知」处理：服务端部署后用一次性 token 对新端点 PUT 4 MB 与 9 MB 各探一次，区分我们的 JSON 413 与反代的 HTML 413。
- 手机端新依赖：`@noble/ciphers@2.4.0`、`@scure/bip39@2.4.0`（带 `@scure/base@2.4.0`）都钉 `@noble/hashes@2.4.0`，因此 `@noble/hashes` 从 2.0.1 升到 2.4.0，`npm ls @noble/hashes` 必须只有一份。Hermes 没有 `crypto.getRandomValues`：主密钥只能用 `expo-crypto` 的 `getRandomBytes(16)`，绝不调用 noble／scure 的随机函数。
- 本机 `/tmp` 是满的 tmpfs：mobile 测试要 `TMPDIR=/var/tmp/anan-tests`。

## 二、与第二部分概要的偏离（设计定稿）

1. **对象头不带明文 sha256**。概要里的对象头含素材 sha256，会让服务端能确认「某张已知照片是否在库里」，违反零知识。定稿：对象 id = `hkdf(sha256, K, undefined, "anan-objid-v1/" + 素材sha256 + "/" + part, 32)` 的 hex；对象头 = `ANANOBJ1 | alg(1) | keyId(8) | objectId(32) | chunks(4) | final(1)`；每块 AAD 绑 objectId + 块序 + final 标志。明文 sha256 → 对象 id 列表的映射只存在于加密清单里。
2. **服务端对象以文件系统为准**：`have`／`status`／`prune` 都 stat 文件，SQLite 只存清单索引与 `backup_limit_bytes`；这样每日 SQLite 快照回滚也不会让对象库「消失」。上传带 `X-Object-Sha256`（密文哈希），边收边算，长度或哈希不符即 400 `OBJECT_CORRUPT` 并删临时文件。
3. **传输层用 XMLHttpRequest**：RN 的 XHR 对 `Uint8Array` 请求体与 `responseType='arraybuffer'` 都有原生支持，而 `fetch(...).arrayBuffer()` 在 RN 上依赖 `FileReader.readAsArrayBuffer`，不稳。`HttpClient` 可注入：真机用 XHR，vitest e2e 用 Node fetch。宪法白名单里的第二个 `fetch(`／`XMLHttpRequest(` 文件就是 `src/sync/transport.ts`。
4. **清单备份 `.xmbm` 与分卷 `.xmb`** 的 meta 都沿用 `BackupMetaV2` 形状（`version: 2`）；分卷只多一个可选 `set` 字段，单卷装得下时不写 `set`，与 Build 68 同格式。
5. 远端清单本体 = 与 `.xmbm` 同一套 meta + 实体 NDJSON，切成 1 MiB 明文块封成普通对象；`PUT /backup/manifest` 只传 < 64 KiB 的密文索引（清单对象 id 列表、总字节数、时间）。服务端 prune 的 keep 列表由手机在每次备份末尾发出。

## 三、提交清单（21 个，全部在 main）

### 提交 1 · 宪法重构
- `mobile/scripts/local_boundary.py`（可导入）：`check(root: Path) -> list[str]`，规则：
  - `fetch(`／`XMLHttpRequest(`／`WebSocket(` 只允许出现在 `src/ai/client.ts`、`src/sync/transport.ts`；
  - 每个 `src/**` 文件都不得含子串 `serverUrl`、`credentials`；
  - `src/local/**` 里只有 `App.tsx`、`Settings.tsx` 允许 import `../sync/`；`src/sync/**` 不得 import `../local/`（除 `brand`、`model`、`backup*`、`files` 这几处只读依赖——按 import 路径白名单）；
  - `package.json` 不得含 `next`、`better-auth`、`drizzle-orm`、`expo-network`；
  - 服务地址字面量 `https://capsule.yep.li/api/v1` 只在 `src/local/brand.ts`（`SERVICE_URL`），`src/ai/client.ts` 里不再出现字面量。
- `mobile/scripts/verify-local-boundary.py` 变薄包装（调用 `check` 并打印）；`mobile/scripts/test_local_boundary.py` 6 例（临时目录造违规：越界 fetch、`credentials` 子串、local 越权 import sync、地址字面量跑到别处、禁用依赖、干净树通过）。
- `src/local/brand.ts` 增 `SERVICE_URL`；`src/ai/client.ts` 改为 `import { SERVICE_URL }`。
- `AGENTS.md` 加一句：「备份传输只走 `src/sync`；`src/local` 不得联网；远端只存密文，密钥只以恢复码形式离开手机。」

### 提交 2 · 格式层（纯函数）
- `src/local/backup-format.ts`：`BACKUP_MAGIC_V3 = "XIAOMEI3"`（清单备份，不含素材字节）、`VOLUME_LIMIT = 2 GiB`、`type BackupSet = { id: string; index: number; count: number; from: number; take: number }`、`BackupMetaV2.set?: BackupSet`、`encodeMetaV2(library, entityBytes, entityCount, options?: { set?: BackupSet; createdAt?: string })`、`decodeMetaV2` 校验 `set`（id 8 hex、0 ≤ index < count、from+take ≤ blobs.length）、`planVolumes(blobs: BackupBlob[], headerBytes: number, limit = VOLUME_LIMIT): { from: number; take: number; bytes: number }[]`（贪心装箱、单个大于上限的 blob 独占一卷、绝不劈开）、`setId(): string`（8 hex，来自 `randomUUID`）。
- `tests/backup-format.test.ts` +7：单卷不写 set、多卷计划、超大 blob 独占、空库一卷、set 校验正反例、meta 往返。

### 提交 3 · 文件层与夹具
- `src/local/files.ts`：导出 `CHUNK = 262144`、`blobDirectory`（`Documents/anan-v1/blobs`）、`blobFile(sha256): File`（两级前缀目录 `blobs/ab/ab…`）、`ensureDirectories` 一并建 blobs；`hashFile` 复用 `CHUNK`。
- 三处 vitest 的 expo-file-system 假件（`local-backup.test.ts`、`archive.test.ts`、`rename.test.ts` 已有）补齐：`Directory.list()` 区分子目录、`Directory.delete()`、`File.create({ intermediates, overwrite })`、`Paths.cache`、`Paths.availableDiskSpace`、`FileMode`；`local-backup.test.ts` 里数 `mediaDirectory` 的 `readdirSync` 计数不受影响（blobs 在另一个目录）。

### 提交 4 · 本机 blob 库 · 写入侧
- `src/local/backup.ts`：`createBackup(state, onProgress?: (stage: string) => void, signal?: AbortSignal): Promise<File>` 改为增量：对 `backupBlobs(state)` 逐条 `ensureBlob(m, blob)`（已存在且长度对 → 跳过；否则 `<sha256>.part` 边写边算 sha256 → 长度 + 哈希双验 → `move` 到位；异常删 `.part`），再写 `anan-YYYYMMDD-HHMM-xxxxxxxx.xmbm`（`XIAOMEI3` + meta + 实体），最后 `verifyManifest(file)` 读回核对；`pruneBackups` 保留位改按 `.xmbm` 与旧 `.xmb` 合并排序。
- `tests/local-backup.test.ts`：既有「导出并恢复」「拒绝损坏」「缺素材不算成功」等用例改为走 `.xmbm`（断言 blob 文件名 == 内容 sha256、第二次备份不重写已存在的 blob、`.part` 不残留）。

### 提交 5 · 本机 blob 库 · 读回侧
- `inspectBackup(file: File | File[], extract = false)` 按魔数分发：`XIAOMEI3` → `inspectManifest`（每个 blob 在库里存在、长度对、提取时逐块哈希复制到 media 目录，哈希不符整份失败）；`XIAOMEI2`／`XIAOMEI1` 不变。
- `restoreBackup`／`recoverStartupBackup` 签名不变；`App.tsx` 启动救援候选 = `.xmbm` ∪ `.xmb`，仍只推荐校验通过的最新一份。
- 测试 +3：从 `.xmbm` 恢复、blob 缺失或被改字节时拒绝且当前库不动、启动救援认 `.xmbm`。

### 提交 6 · 保留与回收
- `pruneBackups(keep = 3, protect?)` 同时管理 `.xmbm` 与 `.xmb`；新增 `collectBlobs(): { removed: number; bytes: number } | null`：保留集 = 所有 `.xmbm` 清单 blobs 的并集（任一清单读不出来 → 返回 null、本轮不删）；删除并集之外的 blob 与所有 `.part`。`createBackup` 结束时调用一次。
- `listLocalBackups(): { file: File; label: string | null; bytes: number; manifestOnly: boolean }[]` 给备份页（`.xmbm` 显示的大小 = 清单 + 其引用的 blob 总字节）。
- 测试 +3：删掉旧清单后 GC 只删失去引用的 blob、坏清单阻止 GC、`.part` 被清。

### 提交 7 · 夹具与冒烟
- `mobile/scripts/local_fixture.py`：`read_backup` 认 `XIAOMEI3`（只解析清单）；`seed` 除 v1 `baseline.xmb` 外再落一份 `.xmbm` + 对应 blob（真机冒烟顺带验清单备份可恢复）。
- `smoke-ios-regression.py`：备份文件 glob 改 `anan-*.xmb*`，并核对 blob 文件名 == 内容 sha256。
- `smoke-android.py`／`NativeRegressionTests.swift` 的备份闭环步骤文本不变（「恢复这份备份」「恢复并替换」「恢复完成。」）。

### 提交 8 · 从 blob 库拼 `.xmb`（导出分卷）
- 新文件 `src/local/backup-export.ts`：`planExport(state, limit = VOLUME_LIMIT): { volumes: { from; take; bytes }[]; totalBytes: number }`、`assertExportSpace(bytes, free = Paths.availableDiskSpace)`、`purgeExports()`（`Paths.cache/export`）、`writeVolume(state, plan, index, setId, createdAt, onProgress?, signal?): Promise<File>`（单卷时不写 set、字节级同 Build 68 v2；素材从 blob 库读，缺失时回退 media 目录，两处都没有则整卷失败并删半成品）。
- 测试 `tests/backup-export.test.ts` +5：单卷与旧 `createBackup` 输出同形（旧读取器可恢复）、三卷各自可独立读 meta、缺 blob 整卷失败、空间不够先报错、停止删半成品。

### 提交 9 · 多卷读取
- `inspectBackup(File[])`：同一 `set.id`、`count` 一致、index 覆盖 0…count-1 无重复、各卷 meta（去掉 set）与实体段逐字节一致，否则「这几卷不是同一份备份」／「还缺第 N 卷」；旧单卷路径不变。
- `Settings.tsx` 与 `App.tsx` 的 `DocumentPicker.getDocumentAsync({ multiple: true })`。
- 测试 +4：乱序选卷、缺卷、混入别的备份、单卷照旧。

### 提交 10 · 备份页导出状态机
- `Backup()` 的「导出完整备份」：`planExport` → 逐卷 `writeVolume` → `shareBackup`；按钮标题「正在写第 1 卷／共 3 卷」「保存第 2 卷／共 3 卷…」，同一行「停止」（`backup-stop`）；单卷时体验与今天一致（安卓冒烟 `tap('backup-export')` 后仍 3 秒内出分享面板）。`lastExportAt` 在最后一卷分享后写。
- 「本机保留的备份」列表改用 `listLocalBackups()`。

### 提交 11 · 服务端对象库与路由
- `server/src/backup-store.ts`：`class BackupStore { constructor(root: string, db: Database) }`，方法 `objectPath(memberId, id)`、`async receive(memberId, id, stream, { declared?: number; sha256: string; limit: number }): Promise<{ bytes: number; created: boolean }>`（写 `root/tmp/<uuid>.part` → 长度／哈希双验 → `rename`）、`read(memberId, id): ReadStream | null`、`stat(memberId, id)`、`have(memberId, ids): Set<string>`、`usage(memberId): { objects: number; bytes: number }`、`prune(memberId, keep: Set<string>, olderThanMs = 3600000): { removed; bytes }`、`wipe(memberId)`、`sweepTemp(olderThanMs)`、`freeBytes(): Promise<number>`（`fs.promises.statfs`）、清单 `putManifest(memberId, keyId, index)` / `getManifest(memberId)`。
- `store.ts`：表 `backup_manifests(member_id PRIMARY KEY, key_id, index_b64, bytes, updated_at)`、列 `members.backup_limit_bytes INTEGER NOT NULL DEFAULT 21474836480`（旧库 ALTER）；`Member` 增 `backup_limit_bytes`。
- `app.ts`：`addContentTypeParser('application/octet-stream', passthrough)`；路由 `GET /api/v1/backup/status`、`POST /api/v1/backup/objects/have`（≤ 5000 个 id）、`PUT /api/v1/backup/objects/:id`（64 hex；`Content-Length` 预检 + 落盘计数，硬上限 8 MiB → 413 `TOO_LARGE`；磁盘剩余 < 5 GiB → 507 `SERVER_FULL`；配额 → 413 `QUOTA_FULL`；每成员并发 > 2 → 429 `BUSY`）、`GET /api/v1/backup/objects/:id`、`PUT/GET /api/v1/backup/manifest`（索引 ≤ 64 KiB base64）、`POST /api/v1/backup/prune`、`DELETE /api/v1/backup`。备份路由不走 `throttle()`。
- `server/tests/backup.test.ts` ~10 例：上传读回逐字节一致、哈希不符 400 且无残留、超限 413、配额 413、并发 429、have、prune 只删 keep 之外且超 1 小时、清单往返与 keyId、删库、未登录 401、成员之间隔离。

### 提交 12 · 主人视角与部署
- overview 每个成员带 `backup: { objects, bytes, limitBytes }` 与 `freeBytes`；`PATCH /admin/members/:id` 接受可选 `backupLimitBytes`；`DELETE /api/v1/admin/members/:id/backup`；`manage.ts wipe-backup <登录名或成员名>`；`server/scripts/verify-service.py` 加备份段（上传 → have → 读回 → 清单 → prune → 删库）。
- `deploy/README.md` 新节「远端备份对象库」：路径、配额、水位、反代三行（`client_max_body_size 16m; proxy_request_buffering off; proxy_read_timeout 130s;`）、`backup.sh` 不覆盖对象库、「对象库是副本不是源头」。
- 部署 → `verify-service.py` → 探反代（4 MB 期望 200、9 MB 期望我们的 JSON 413）。

### 提交 13 · 密码学
- 依赖：`@noble/ciphers@2.4.0`、`@scure/bip39@2.4.0`、`@noble/hashes` → 2.4.0。
- `src/sync/crypto.ts`：`KEY_BYTES = 16`、`newMasterKey(random = getRandomBytes)`、`keyIdOf(K): string`（sha256 前 16 hex）、`encKeyOf(K)`（HKDF "anan-backup-v1/enc"）、`noncePrefixOf(K, sha256)`（HKDF "anan-nonce-v1/"，20 字节）、`objectIdOf(K, sha256, part)`、`mnemonicOf(K): string`、`keyFromMnemonic(words: string): Uint8Array`（规整空白、小写、校验和错误抛「恢复码不对」）、`sealChunks(K, objectId, chunks: Uint8Array[]): Uint8Array`（对象格式见二·1）、`openObject(K, bytes): { objectId; chunks: Uint8Array[] }`、`sealSmall`／`openSmall`（清单索引）。
- `tests/sync-crypto.test.ts` +8：往返、AAD 篡改任一字节即失败、同 key 同内容对象字节一致、不同 key 不同 id、助记词往返与错词、keyId 稳定、Node 端 64 MiB 基准（打印 MB/s，不断言）。

### 提交 14 · 状态与规划器
- `src/sync/state.ts`：`RemoteState = { version: 1; enabled: boolean; keyId: string; lastBackupAt?: string; lastBackupBytes?: number; lastBackupObjects?: number; lastError?: string }`，`readRemoteState()`／`writeRemoteState()`（`Documents/anan-v1/sync/state.json`，先写 `.part` 再 move）；钥匙 `loadKey()`／`storeKey()`／`forgetKey()`（SecureStore `anan-backup-key-v1`）。
- `src/sync/planner.ts`（纯函数）：`CHUNK_BYTES = 1 MiB`、`CHUNKS_PER_OBJECT = 4`、`objectsOf(blob: BackupBlob): { part: number; from: number; bytes: number }[]`、`planUpload(blobs, missing: Set<string>, idOf): UploadItem[]`、`progressLabel(done, total, bytes)`。
- `tests/sync-planner.test.ts` +4。

### 提交 15 · 传输层
- `src/ai/session.ts`：从 `client.ts` 抽出 `getToken`／`disconnect`／`hasConsent`／`giveConsent`／`saveToken`（`client.ts` re-export，测试不变）。
- `src/sync/transport.ts`：`type HttpClient = (req: { method; url; headers; body?: Uint8Array | string; timeoutMs }) => Promise<{ status: number; body: Uint8Array }>`、`xhrClient`、`class SyncError extends Error { code }`、`createTransport(http = xhrClient, base = SERVICE_URL)` → `{ status(), have(ids), put(id, bytes, sha256), get(id), putManifest(keyId, index), getManifest(), prune(keep), wipe() }`；115 s 超时；错误映射：401 → `AUTH_REQUIRED`「请先在 AI 设置登录」，413 `QUOTA_FULL`／`TOO_LARGE`、507 `SERVER_FULL`、429 `BUSY`，非 JSON 响应体 → `SERVER_ERROR`，网络 → `NETWORK`「现在连不上服务，请稍后再试。」。
- `tests/sync-transport.test.ts` +5（假 http）。

### 提交 16 · 引擎：备份
- `src/sync/engine.ts`：`runRemoteBackup(state: Library, deps: { transport; key; onProgress?; signal? }): Promise<RemoteState>`：`ensureKey` → `status`（keyId 不同 → 「这台服务上已有另一把钥匙的备份」）→ 清单编码（meta + 实体）→ 对象规划 → `have` → 逐素材读 256 KiB 块拼 1 MiB 明文块封对象 `put`（`X-Object-Sha256`）→ 清单对象 → 索引 `putManifest` → `prune(keep)` → 写 state。任何一步失败保留已上传对象（下次 `have` 自然续传）。
- `verifyRemoteBackup(deps)`：索引 → 清单 → `have` 全部对象都在。
- `tests/sync-engine.test.ts` +5（内存假 transport）：首轮全传、第二轮只传新增、中途失败续传、keyId 不符拒绝、prune 参数正确。

### 提交 17 · 引擎：恢复
- `restoreFromRemote(key, deps, onProgress?, signal?): Promise<File>`：`getManifest` → 校 keyId → 下载清单对象解出 meta + 实体 → 逐素材下载对象、`openObject`、写 blob 库（已存在且长度对的跳过 = 断点续传）→ 写 `.xmbm` 到 backupDirectory → 返回文件，交给现有 `restoreBackup`／`recoverStartupBackup`。
- 测试 +3：往返、缺对象整份失败不写 `.xmbm`、错钥匙在下载前就判出。

### 提交 18 · UI
- `src/sync/RemoteBackupCard.tsx`（`testID="remote-card"`，备份页最后）：三态——未登录（一句说明 + 文字级「去登录」）、未开启（说明 + 次级「开启远端备份」→ 生成钥匙 → 进恢复码页）、已开启（「上次备份 …」+ 次级「现在备份」／进行中标题「正在上传 n/N」+「停止」、文字级「查看恢复码」（应用锁开启时先生物识别）、「验证远端备份」、「从远端恢复」、危险文字「关闭远端备份」→ Alert 两路：保留远端／同时删除远端）。
- `src/sync/RecoveryCode.tsx`：`mode: "show"`（12 词三列网格、「我已抄在纸上」）／`"enter"`（输入框 + 「开始恢复」，错词提示）。路由 `RecoveryCode: { mode: "show" | "enter" }`；`App.tsx` 注册；`Settings.tsx` 只是渲染 `<RemoteBackupCard busy={busy} />`（宪法允许的两处 import 之一）。
- DESIGN.md「我的」备份页段落追加远端卡；冒烟离线断言 `remote-card` 与「去登录」。

### 提交 19 · 端到端
- `tests/sync-e2e.test.ts`：`spawn(node server/src/index.ts)`（`DB_FILE` 临时、`PORT` 随机、`CPA_KEY_FILE` 指向临时文件）→ `/setup` 拿 token → 备份 → `verify` → 删本机 blob → `restoreFromRemote` → 内容一致。CI `local-quality` 作业加一次 `npm ci`（server）。

### 提交 20 · 收尾
- `CHANGELOG.md`「Build 70 — 传家 · 中」+ 降级警告（`.xmbm` 与分卷 `.xmb` 只有 70 起能读）；`README.md`（使用第 5 条、数据与结构、AI 使用末段）；`HANDOFF.md` 一／二／三节；`DESIGN.md` 通读；本文件顶部加「实施偏离」；`mobile/app.json` 70。
- 派发 `mobile-build.yml`，三作业全绿后把 APK／IPA 校验和写进 HANDOFF；首个真机版记录加密 MB/s。

### 提交 21（可选）· `mobile-build.yml` 加 `release_tag` → GitHub Release

## 四、验收清单

1. 每提交前：`cd mobile && TMPDIR=/var/tmp/anan-tests npm test && npm run typecheck && npm run lint`；`cd server && npm test && npm run typecheck`；`python3 mobile/scripts/verify-local-boundary.py`；`python3 -m unittest discover -s mobile/scripts -p 'test_*.py'`。
2. 服务端部署后 `python3 server/scripts/verify-service.py --base http://127.0.0.1:3140 --container anan-ai-ai-1` 全过；反代探测 4 MB → 200、9 MB → JSON 413。
3. 本机：导出单卷 `.xmb` 能被 Build 68 的读取器恢复（`local_fixture.read_backup` 当独立裁判）；三份保留备份的磁盘占用 ≈ 1× 素材而不是 3×；删掉清单后 GC 只回收失去引用的 blob。
4. 远端：开启 → 备份 → 卸载重装 → 登录 → 输入恢复码 → 恢复，照片哈希一致；错恢复码在下载前被拒；服务端磁盘上看不到任何明文、文件名或 sha256。
5. 派发 `mobile-build.yml` 三作业全绿，`result.json` 既有键全为 true，新增 `remoteCardOffline`。
