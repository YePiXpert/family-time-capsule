# 1.0 发布候选验收报告

> 候选版本：`1.0.0-rc.1`
> 验收日期：2026-09-03
> 结论：自动化与 Docker 门禁通过；稳定 `1.0.0` 等待真实设备记录。

## 自动化证据

| 门禁 | 结果 |
| --- | --- |
| ESLint / TypeScript | 通过 |
| Vitest | 64 files，455 tests，通过 |
| Playwright production E2E | 32 tests，通过 |
| Production disaster roundtrip | 6 tests，通过 |
| Next.js production build | Next 16.3.3，webpack build，通过 |
| React Native quality | 2 files / 8 tests；TypeScript / ESLint；Expo Doctor 21/21；iOS/Android Hermes bundle，全部通过 |
| Android native package | ARM64 Release，299 Gradle tasks；APK Signature v2 验证通过 |
| GitHub native cloud build | run `33806978669` 全绿；Android APK 与 iPhoneOS unsigned IPA 已下载复验 |
| Production dependency audit | `npm audit --omit=dev --audit-level=moderate`，0 vulnerabilities |
| Mobile production dependency audit | `npm audit --omit=dev`，0 vulnerabilities |
| Benchmark | 10,000 events + 50,000 assets，通过；数字见 `PERFORMANCE.md` |

自动化覆盖真实 0.1.3 fixture 向前迁移、WAL 一致快照、失败回滚、完整虚构家庭
destroy/restore、权限负例、公开注册闸门、持久化限流、上传边界、媒体 Range、AI
consent/jobs/handlers、搜索、故事、口述、胶囊、书籍、WebDAV、Share Target、回收站与导出。

Android 原生包在 GitHub Ubuntu runner 上执行 299 个 Gradle tasks 后生成，并在下载后再次
使用 Android SDK 36 验证。它使用临时 debug key 的 APK Signature v2；正式商店分发仍需
长期 release keystore。精确包信息与哈希见下节。

## 原生云构建证据

GitHub Actions run
[`33806978669`](https://github.com/YePiXpert/family-time-capsule/actions/runs/33806978669)
在分支 `mobile-build/1.0.0-rc.1-20260903`、提交
`8c35c7b59520eac385d361689af0e8a3893dcd14` 上于 2026-09-03 完成，三个 job 均成功：
React Native quality 1m14s、iOS unsigned IPA 5m19s、Android APK 11m03s（其中 299 个
Gradle tasks 10m28s）。云端产物保留 30 天。

| 云端产物 | 复验结果 |
| --- | --- |
| `FamilyTimeCapsule-android.apk` | 28,831,068 bytes；SHA-256 `da945d492298f275e7eb7f55bbc0057df3a4f391c10cd9560171a3c70531cd85` |
| `FamilyTimeCapsule-ios-unsigned.ipa` | 7,950,219 bytes；SHA-256 `c2e6089d2b3b177b608b6950ecc1405279b6745399836f29bac574f4eb16a231` |

APK 经 Android SDK 36 `apksigner` 与 `aapt2` 二次验证：APK Signature v2 有效，包名
`app.familytimecapsule.mobile`，`versionName=1.0.0`，min/target SDK 24/36，仅含
`arm64-v8a`，包含 `libhermesvm.so`、`libexpo-sqlite.so`、`libreactnative.so` 与
Hermes bytecode `assets/index.android.bundle`；声明相机权限，不含 `SYSTEM_ALERT_WINDOW`。
它使用临时 debug key，适合直接侧载测试，不作为正式商店签名。

IPA 经 `unzip -tq` 与解包二次验证：bundle id `app.familytimecapsule.mobile`，版本
`1.0.0 (1)`，最低 iOS 16.4，平台为 `iphoneos`，主程序是 64-bit ARM64 Mach-O；包含
Hermes、React Native、Expo SQLite、Expo SecureStore 与 Hermes `main.jsbundle`，并带有
相机/相册用途说明，确认不是 PWA/WebView 套壳。包内没有 `_CodeSignature` 或
`embedded.mobileprovision`，因此必须用 Apple 开发者身份或设备自签方案签名后才能安装，
不能把未签名 IPA 直接安装到普通 iPhone。

## Docker 主机实测

在 Linux / Docker Compose / Node 24 镜像上从当前工作树构建并执行：

- app HTTP health 与 worker PID/heartbeat 拓扑均 healthy；容器内 ffmpeg/ffprobe 可用，
  `/data` 可写，登录页、manifest、DB health 与匿名媒体 401 正常。
- 建立家庭、上传 JPEG、确认事件；`docker compose down` 后用同一卷重建，家庭/事件/
  素材仍为 1/1/1，原件 SHA-256 保持
  `cccc36de1f29341b538f4afbfe9ca185a2bc5917e5c3b9bfae20216c5c134ab3`。
- 源实例导出经独立 verifier 通过；在独立 Compose project、端口和新卷中先 `/setup`，
  再运行容器内 restore CLI。新管理员在 `/onboarding` 绑定恢复的 Person 后，时间轴、
  事件详情和原件 HTTP 读取正常；二次导出 18 个业务文件，原件 SHA 与源端一致。
- 从干净 Git `HEAD` 构建真实 0.1.3 镜像，在独立卷创建家庭/事件/素材；停止旧容器后
  用当前镜像接管同一卷。登录、事件详情、210-byte 原件与 post-upgrade export/verify
  全部通过，原件 SHA 不变。
- 验收容器、网络、卷、旧镜像和临时 worktree 均已删除；没有删除用户文件。

## 性能与资源边界

Linux / Node 24 最终复验：数据构造 1.4s，Timeline 前两页 0.0ms，Inbox 1.6ms，FTS
重建 0.3s，命中 5.7ms，无命中 0.1ms，日期过滤 7.5ms，Story 全年素材 51.3ms。

媒体读取、导出以及 WebDAV PUT/GET 哈希为流式。浏览器上传在强制有限
`Content-Length` 后由 `formData()` 处理；恢复 CLI 由 yauzl 从文件句柄读取 Central
Directory，原件以 entry stream 逐个验字节/SHA-256 并原子落盘，不把压缩包或完整原件
载入 JS heap。Central Directory 与单个 ≤64MB metadata 文件有明确上限，精确边界见
`PERFORMANCE.md`。

## 稳定版尚缺的外部证据

自动化不能替代真实操作系统的相册/文件选择器、HEIC/HEVC 解码、系统分享菜单、PWA
安装模式、原生签名安装与离线文件行为。发布 `1.0.0` 前，必须在
`REAL_DEVICE_TEST.md` 记录：

- iOS Safari + installed PWA；
- Android Chrome + installed PWA；
- Windows Chrome 或 Edge；
- GitHub 云构建的原生 IPA/APK 在真实 iPhone/Android 上安装、离线重启、断网记录、
  恢复网络幂等补传与完整快照；
- 设备原生 JPEG/HEIC/MOV/MP4/M4A/MP3/WAV、Live Photo 双文件与 >200MB 视频；
- 拍照/上传/进度/重试/收件箱/时间轴、原件下载、离线壳和系统 Share Target。

在以上记录完成前：不宣称 stable，不把 package 升为 `1.0.0`，不创建 `v1.0.0` tag。

## 已知运维边界

- 受支持的 Compose 拓扑是一个 app 进程加一个 worker；空库首次 setup 不支持多个 app
  副本竞争。正常运行时的 SQLite 原子限流、邀请 claim 和 worker lease 支持进程并发。
- 导出 ZIP 自带完整性哈希但不加密；异地副本应放在加密卷/加密容器中。
- 邀请 token 为 256-bit、一次性原子 claim；应用不设低阈值邀请尝试限流以避免共享 NAT
  误伤。生产代理应做通用 DoS 限制，并在日志落盘前隐藏 `/invite/*` 路径。
- TLS、HSTS、反向代理 access-log redaction 与 `BETTER_AUTH_URL` 的最终 HTTPS origin 由
  部署方负责。
