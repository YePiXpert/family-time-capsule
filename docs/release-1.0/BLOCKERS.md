# 正式 1.0.0 外部阻塞清单(BLOCKERS)

> 只登记**仓库外**才能解除的阻塞;每项写明:需要什么、谁提供、解除后要跑什么验证。
> 工程内部未完成项在 REQUIREMENTS.md 跟踪,不在这里重复。
> 这些阻塞阻止对应的"正式发布"声明,但不允许因此停止其他工程工作。

## 当前外部阻塞

| ID | 阻塞 | 需要的最少输入 | 解除后验证 | 影响范围 |
| --- | --- | --- | --- | --- |
| BLK-1 | CPA(gpt-5.6-luna)真实凭据 | 用户自备 CPA Base URL + API Key(文字+图片能力) | `ftc ai test --capability text/vision` 真实链路;场景 #11 | "默认 AI 文字/图片链路正式可用"声明;AI live 评测 |
| BLK-2 | MiMo ASR 真实凭据与契约核验 | MiMo Base URL + Key;按官方当前文档核对 mimo-v2.5-asr 端点/参数 | `ftc ai test --capability transcription`;中文方言样本;场景 #11/#13 | "语音转写正式可用"声明 |
| BLK-3 | Android 发布签名 | 长期 keystore(用户提供并安全保管;或明确接受当前测试密钥的限制并记录) | 同签名覆盖安装保留资料(场景 #31);versionCode 12 上架渠道 | Android 正式分发声明 |
| BLK-4 | iOS 分发渠道 | Apple Developer 账号/证书/TestFlight 或 App Store 审核;App Group/分享扩展配置 | 签名 IPA 真机安装;分享扩展验收(场景 #31) | iOS 正式分发声明 |
| BLK-5 | 真实 VPS 端到端验收 | 可用的美国 VPS + 域名(DNS/TLS)或用户授权在自有服务器演练 | 双账号扫码、离线重开、家庭隔离、救援恢复、旧数据升级、Caddy 新机路径、A/B/C/D 全类故障注入(场景 #1–10、25、27) | "真实家庭可上线"声明 |
| BLK-6 | 法律/合规审核 | 隐私政策、儿童数据(PIPL/COPPA 适用性)、跨境、平台删号要求的适用法域审查结论 | 更新 SEC-6 对应文档与商店申报材料 | 商店/公开推广 |
| BLK-7 | 真机设备 | 至少一台 Android + 一台 iOS 真机(或明确仅模拟器声明) | REAL_DEVICE_TEST.md 全清单留档 | "真机验收完成"声明 |
| BLK-8 | AI 评测样本 | ~200 份许可/合成中文样本(含方言、噪音、旧扫描) | REL-4 评测报告(命名/修订/转写/Recall) | AI 质量结论 |

## 已解除

| ID | 原阻塞 | 解除记录 |
| --- | --- | --- |
| — | 版本工具误判探索版→1.0 为降级/digest 截取伪版本 | 2026-09-06 M0-V 注册表+release_tool 落地,tests/ops/release-registry.test.ts 全绿 |

## 阻塞期间的纪律

1. 不伪造测试、签名、勾选或版本号来"通过"上述门禁。
2. GitHub Release 保持 prerelease 通道;`v1.0.0` 标签只在全部硬门禁解除后创建
   (CI 已强制:stable 通道 tag 需要 `docs/release-1.0/STABLE_READINESS.md`)。
3. 发行说明必须如实写明"unsigned/test-key/未实测"边界,如既往 alpha 所做。
4. 每个 BLK 解除后:先在 ACCEPTANCE.md 登记证据,再更新本文件状态。
