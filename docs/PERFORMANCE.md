# Performance（1.1 M8）

测量方法：`npm run benchmark`（`--quick` 用 1k/5k 子集）。脚本在独立 DATA_DIR
里构造 **10,000 个 MemoryEvents + 50,000 条 asset 元数据行**（单家庭、
2018 年全年分布、标题含序号便于精确命中），每项测量先预热一次再计时。

完整模式还通过真实 resumable service 写入并取消一份 **500 MiB** 生成流；脚本复用一个
8 MiB chunk，不提交大 fixture，并在循环中记录 RSS 峰值。

## 实测数字（2026-09-04，Linux x86_64 / Node 24 / SQLite WAL）

| 操作 | 结果 |
| --- | --- |
| 10k 事件 + 50k 素材构造 | 1.5 s |
| Timeline 首页（30 条） | 0.0 ms |
| Timeline 第二页（keyset 游标） | 0.0 ms |
| Inbox 分页（keyset，50 条） | 0.9 ms |
| 搜索索引全量重建（10k 事件） | 0.4 s |
| 搜索：3 字命中（FTS MATCH） | 7.1 ms |
| 搜索：无命中 | 0.1 ms |
| 搜索：2 字命中 + 日期范围过滤 | 8.8 ms |
| Story 素材收集（全年 10k 事件） | 42.0 ms |
| 500 MiB 顺序续传（8 MiB chunk） | 0.3 s；峰值 RSS 增量 0.1 MiB |

时间轴与收件箱都是 keyset 分页（`(occurredAt,id)` / `(createdAt,id)` 游标），
深翻页成本与总量无关。搜索经 FTS5 bigram 索引（migration 0023，可重建
derivative），过滤器走带索引的关系查询。

## 内存形态（审计结论）

| 路径 | 形态 |
| --- | --- |
| 媒体回放 `/api/media` | 流式（`createReadStream` + HTTP Range）；不缓冲整文件 |
| 导出 | archiver 流式打包（`archive.file` 从磁盘流读）；原件 SHA-256/字节数由文件流逐项复验 |
| 续传上传 | `/api/uploads` 的原始二进制 `PATCH` 以 8 MiB 有界 chunk 顺序落临时文件；complete 再从文件流计算 SHA-256、嗅探/解析并原子发布，不构造完整文件 Buffer |
| 旧 multipart 上传 | 只兼容小文件客户端；在 `formData()` 前强制有限 `Content-Length` 与图片 50MB / 音频 200MB / 视频 500MB 上限，新客户端不使用该大文件路径 |
| 恢复 | CLI 用 yauzl 从文件句柄按需读取 ZIP；压缩包不进入 JS heap。Central Directory 最多 20 万条，metadata 单文件最多 64MB；原件逐条解压流式验字节/SHA-256并原子落盘，总解压上限 25GB、单条上限 2GB |
| AI（转录/视觉/视频） | 输入上限 25MB / 20MB；视频抽帧合计 ≤ 12MB；帧为临时内存对象 |
| WebDAV 备份 | 磁盘文件流式 PUT；GET 回读用 `ReadableStream` 增量计算字节数和 SHA-256；成功/失败都清理临时导出 |

已知边界（如实声明）：旧 multipart 兼容端点仍缓冲一个受大小上限约束的请求；生产新路径
不使用 multipart。恢复 CLI 会在内存保留受 20 万条上限约束的 Central Directory 索引，
并一次缓冲一个不超过 64MB 的 JSON metadata 文件。`restoreFromZip(Buffer, ...)` 是测试/
程序化兼容入口，调用方本来就持有压缩包 Buffer；生产 `restoreFromZipFile` 不整包读取。
WebDAV 传输也不复制整个 ZIP 到 JS heap。

## 增长页清单（全部有界）

- 时间轴：keyset 游标（30/页）。
- 收件箱：keyset 游标（50/页）；聚类扫描内部上限 200 条目。
- Web 批量导入：客户端 worker pool 固定最多 3 个文件；失败一项不停止其他项，服务器状态可恢复。
- 原生 People/Stories/Capsules/Requests/Portals/Imports：独立 cursor DTO 与缓存，一个领域失败不清空其他领域。
- 搜索：MATCH 上限 400 行 + 结果分组上限。
- 故事列表：上限 500；段落每篇上限 100。
- 回收站：每类型上限 100。
- 讲述链接：打开上限 20/家庭；提交 5 条/小时/链接。
- 续传：同家庭 active upload 与临时总空间有硬上限；过期清理单次处理量有上限。

## 1.2 媒体阅读衍生物（开发切片）

- MediaJob 不依赖 AI 开关；跨 worker SQLite lease 限制同时一个转换，240 秒租约、
  ffmpeg 180 秒超时、sharp 30 秒超时/6400 万输入像素。请求队列全站 500、家庭 100。
- 阅读图最长边 2048；视频兼容版最长边 1280，不全库自动转码。波形只表示最多前五分钟，
  UI 明确标注。ffmpeg 显式 demuxer、file/pipe 协议、固定参数、单线程，无用户 URL/filter。
- 单输出上限 128 MiB：转换过程中采样磁盘大小并终止超限进程，完成后及流式入库时再检查。
  磁盘监控有 100ms 采样间隔，临时文件可能短暂超过阈值；不宣称 OS 磁盘硬配额。
  家庭衍生物配额 2 GiB；临时输出独立 work-media，过期目录清理，任务不进入 portable archive。
- 原件从文件路径读取；衍生文件以 stream 计算 SHA 并原子发布，避免把完整视频装进 Node Buffer。
- `npx tsx --conditions=react-server scripts/benchmark-media.mts` 使用实际 JPEG/ffmpeg 文件转换，
  20ms 采样 Node RSS 和直属 ffmpeg 子进程 RSS；此数字是观测值，不是操作系统峰值保证。

2026-09-05 本地实际一次运行（虚构 6000×4000 纯色 JPEG、8 秒 1920×1080 测试图视频）：

| 转换 | 输入字节 | 输出字节 | 耗时 ms |
| --- | ---: | ---: | ---: |
| 图片阅读预览 | 140894 | 5086 | 175 |
| 视频封面 | 13089874 | 52005 | 82 |
| 视频声音波形 | 13089874 | 1252 | 82 |
| 视频兼容版 | 13089874 | 1004244 | 1319 |

Node 峰值采样 RSS 154181632 bytes；ffmpeg 峰值采样 RSS 199008256 bytes。
不把两者混成 Node RSS，不使用 mock 吞吐量；本基准未测浏览器或真实手机资源，纯色 JPEG
不代表真实相册压缩率。全屏阅读器只创建当前媒体播放器，关闭/翻页会卸载它。

## 1.2 真实出版处理（2026-09-05）

`scripts/benchmark-books.mts` 在独立临时目录写入 5000×3600 虚构图案 JPEG（167132 bytes），
流式读取 SHA，逐块从原件做 sharp 版面转换，生成 PDF/EPUB，再用 Poppler 渲染 62 页。
本次记录没有同时运行构建或其他出版测试；虚构图案高度可压缩，不能代表真实照片吞吐。

| 实际工作 | 耗时 ms | 20 ms 采样 RSS 峰值 bytes | 输出 bytes |
| --- | ---: | ---: | ---: |
| PDF 渲染子进程 | 2519 | 265338880 | 1514842 |
| EPUB 渲染子进程 | 2603 | 274964480 | 963606 |
| Poppler 页面渲染进程 | 1462 | 21028864 | 页面 PNG |

编排 Node 自身 RSS 采样峰值 94138368 bytes，原件 SHA 不变。浏览器/ffmpeg 未参与本测量，
不填入推算值；以上不是 mock 数值，也不是 OS 精确峰值。渲染器 Node 堆限制 384 MiB，
仍需考虑 sharp/fontkit 原生内存；部署可另设容器内存上限。单任务并发、180s 超时、200 页、
256 MiB 输出以及每家庭 2 GiB 缓存限制不会被 AI 关闭而停用。
