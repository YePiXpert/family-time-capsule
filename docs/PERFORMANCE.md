# Performance（M7）

测量方法：`npm run benchmark`（`--quick` 用 1k/5k 子集）。脚本在独立 DATA_DIR
里构造 **10,000 个 MemoryEvents + 50,000 条 asset 元数据行**（单家庭、
2018 年全年分布、标题含序号便于精确命中），每项测量先预热一次再计时。

## 实测数字（2026-09-03，Linux x86_64 / Node 24 / SQLite WAL）

| 操作 | 结果 |
| --- | --- |
| 10k 事件 + 50k 素材构造 | 1.4 s |
| Timeline 首页（30 条） | 0.0 ms |
| Timeline 第二页（keyset 游标） | 0.0 ms |
| Inbox 分页（keyset，50 条） | 1.6 ms |
| 搜索索引全量重建（10k 事件） | 0.3 s |
| 搜索：3 字命中（FTS MATCH） | 5.7 ms |
| 搜索：无命中 | 0.1 ms |
| 搜索：2 字命中 + 日期范围过滤 | 7.5 ms |
| Story 素材收集（全年 10k 事件） | 51.3 ms |

时间轴与收件箱都是 keyset 分页（`(occurredAt,id)` / `(createdAt,id)` 游标），
深翻页成本与总量无关。搜索经 FTS5 bigram 索引（migration 0023，可重建
derivative），过滤器走带索引的关系查询。

## 内存形态（审计结论）

| 路径 | 形态 |
| --- | --- |
| 媒体回放 `/api/media` | 流式（`createReadStream` + HTTP Range）；不缓冲整文件 |
| 导出 | archiver 流式打包（`archive.file` 从磁盘流读）；SHA-256 逐文件流算 |
| 上传 | 上限 50MB（图）/ 200MB（音）/ 500MB（视）；所有媒体入口在 `formData()` 前要求有限 `Content-Length`，缺失/非法/chunked 请求拒绝；请求体在上限内缓冲。部署建议 ≥ 2GB 内存 |
| 恢复 | CLI 用 yauzl 从文件句柄按需读取 ZIP；压缩包不进入 JS heap。Central Directory 最多 20 万条，metadata 单文件最多 64MB；原件逐条解压流式验字节/SHA-256并原子落盘，总解压上限 25GB、单条上限 2GB |
| AI（转录/视觉/视频） | 输入上限 25MB / 20MB；视频抽帧合计 ≤ 12MB；帧为临时内存对象 |
| WebDAV 备份 | 磁盘文件流式 PUT；GET 回读用 `ReadableStream` 增量计算字节数和 SHA-256；成功/失败都清理临时导出 |

已知边界（如实声明）：上传仍由 `formData()` 缓冲单个有限请求；恢复 CLI 会在内存保留
受 20 万条上限约束的 Central Directory 索引，并一次缓冲一个不超过 64MB 的 JSON
metadata 文件。`restoreFromZip(Buffer, ...)` 是测试/程序化兼容入口，调用方本来就持有压缩包
Buffer；生产 CLI `restoreFromZipFile` 不整包读取。WebDAV 传输本身也不复制整个 ZIP 到
JS heap。完全零拷贝 multipart 仍需作为独立安全评审项实施。

## 增长页清单（全部有界）

- 时间轴：keyset 游标（30/页）。
- 收件箱：keyset 游标（50/页）；聚类扫描内部上限 200 条目。
- 搜索：MATCH 上限 400 行 + 结果分组上限。
- 故事列表：上限 500；段落每篇上限 100。
- 回收站：每类型上限 100。
- 讲述链接：打开上限 20/家庭；提交 5 条/小时/链接。
