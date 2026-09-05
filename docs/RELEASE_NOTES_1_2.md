家庭记忆馆与成长年册 · 1.2.0-alpha.1 prerelease

从真实记忆选材，在 Web 与原生端整理相册/章节、按日历和年龄浏览、阅读照片与家人声音，
并持续编辑照片相册、图文成长册、家人来信三种年册。月度/年度/出生第一周回顾可继续同一草稿。

- 中文正文可搜索的 PDF、通过 EPUBCheck 的 EPUB、自包含精选 ZIP 阅读包。
- 原生主动离线收藏、容量确认、暂停/继续/重试、阅读/播放进度与独立缓存清理。
- 家庭/私人读者范围、来源变化提示、权限收紧后旧产物失效，核心流程无需 AI。
- 完整备份保留相册顺序、手工说明、年册版式、来源、版本和原件 SHA；1.1 旧卷升级、
  旧导出恢复、1.2 二次导出、失败回滚及独立 Docker app/worker 已验证。

本地门禁：根 584 tests、Mobile 77 tests、production E2E 46、disaster roundtrip 7；
lint/typecheck/build、Doctor 21/21、双平台 Expo export 和依赖审计通过。实际 run 与包级
证据以关联 GitHub Actions 和 docs/RELEASE_1_2.md 为准。

APK 为测试签名独立包；IPA 为 unsigned device archive 包，需自行签名部署，不是 App Store 包。
真实设备分享、音视频/安全区、后台下载与含唯一资料旧包的无损升级尚未验收。
不要卸载含本机唯一资料的旧包来尝试新包。请保留原件和完整备份。

精选阅读包可被接收者保存或转发，不能远程收回；它不是完整可恢复备份。
此版本为 alpha prerelease，不宣称 stable。
