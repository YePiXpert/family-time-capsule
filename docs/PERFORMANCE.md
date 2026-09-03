# Performance（M7）

测量方法：`npm run benchmark`（`--quick` 用 1k/5k 子集）。脚本在独立 DATA_DIR
里构造 **10,000 个 MemoryEvents + 50,000 条 asset 元数据行**（单家庭、
2018 年全年分布、标题含序号便于精确命中），每项测量先预热一次再计时。

## 实测数字（2026-09-03，开发机 Windows / Node 24 / SQLite WAL）

| 操作 | 结果 |
| --- | --- |
| Timeline 首页（30 条） | < 1 ms |
| Timeline 深页（keyset 游标） | < 1 ms |
| Inbox 分页（keyset，50 条） | ~3 ms |
| 搜索索引全量重建（10k 事件） | ~3.7 s（`npm run search:rebuild`） |
| 搜索：3 字命中（FTS MATCH） | ~11 ms |
| 搜索：无命中 | < 1 ms |
| 搜索：2 字命中 + 日期范围过滤 | ~15 ms |
| Story 素材收集（全年 10k 事件） | ~95 ms |

时间轴与收件箱都是 keyset 分页（`(occurredAt,id)` / `(createdAt,id)` 游标），
深翻页成本与总量无关。搜索经 FTS5 bigram 索引（migration 0023，可重建
derivative），过滤器走带索引的关系查询。

## 内存形态（审计结论）

| 路径 | 形态 |
| --- | --- |
| 媒体回放 `/api/media` | 流式（`createReadStream` + HTTP Range）；不缓冲整文件 |
| 导出 | archiver 流式打包（`archive.file` 从磁盘流读）；SHA-256 逐文件流算 |
| 上传 | 上限 50MB（图）/ 200MB（音）/ 500MB（视）；解析前按 `Content-Length` 预检拒绝超限请求；请求体经 `formData()` 缓冲（上限内有界）。部署建议 ≥ 2GB 内存 |
| 恢复 | ZIP 解压总量上限 25GB / 20 万文件；压缩包本体经 JSZip 内存缓冲，实例级一次性操作（上限内有界） |
| AI（转录/视觉/视频） | 输入上限 25MB / 20MB；视频抽帧合计 ≤ 12MB；帧为临时内存对象 |
| WebDAV 备份 | 导出文件流式读取上传（`Uint8Array` 单次读入——上限内） |

已知边界（如实声明）：上传与恢复对「单次操作的内存峰值」是有界而非零——
受文档化上限约束。若未来需要零拷贝上传（spool 到磁盘再解析 multipart），
应作为独立安全评审项实施，避免手写多部分解析器引入新的攻击面。

## 增长页清单（全部有界）

- 时间轴：keyset 游标（30/页）。
- 收件箱：keyset 游标（50/页）；聚类扫描内部上限 200 条目。
- 搜索：MATCH 上限 400 行 + 结果分组上限。
- 故事列表：上限 500；段落每篇上限 100。
- 回收站：每类型上限 100。
- 讲述链接：打开上限 20/家庭；提交 5 条/小时/链接。
