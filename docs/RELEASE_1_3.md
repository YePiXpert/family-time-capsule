# 1.3 发布说明（开发中 → 1.3.0-alpha.1）

状态：1.3.0-alpha.1 代码与测试已合入 main；本文随发布推进更新，只记录
已验证的事实，不代填未完成的验收。

## 本版主题：从部署到全家使用

一条真实使用链：VPS 一次部署 → App 内初始化管理员并建家庭 → 本机照片
即存即看 → 明确同意后同步 → 家人扫码/受邀注册 → 两账号同一家庭 →
一键快照/升级/回退/诊断。

## 交付内容（按里程碑）

- **M1 首次启动与实例识别**：App 四入口欢迎页（创建家庭/加入家庭/仅本机/
  登录）；`GET /api/bootstrap` 实例识别（稳定 instanceId、setup 状态）；
  `POST /api/bootstrap/setup` 复用 performSetup 的 App 内初始化；
  `GET /api/mobile/v1/me` 把“账号未建家庭”与“会话失效”分开（不再死循环）；
  `POST /api/mobile/v1/onboarding` App 内建家庭（复用 completeOnboarding）。
- **M2 邀请注册**：`GET /api/invitations/preview`（只读、不消耗）与
  `POST /api/invitations/accept`（原子 claim、幂等恢复）；
  `POST /api/mobile/v1/invitations` 在 App 内创建一次性邀请；管理员可展示
  本地生成的二维码、系统分享、显式复制；受邀人扫码/粘贴 → 预览确认 →
  注册 → 自动登录。访客投递 token 不能注册账号。
- **M3 本机即存即看**：本机记录详情页（图片/视频/音频复用原生阅读器、
  文字全文；文件缺失如实报错并提供恢复入口）；时间轴本机条目直达详情；
  保存/同步/整理三态分离展示；保存按钮不再等待整条同步；收件箱“确认”
  携带当前未保存编辑（服务端同事务）；发生时间用平台日期时间控件，
  支持“待补时间”。
- **M4 同步授权与救援**：首次连接上传需显式授权（全部/部分/仅本机），
  目的地绑定 serverUrl+账号，切换后重询；切换连接清空服务器侧缓存并
  以代际栅栏丢弃旧目的地结果；失败操作拆分为“保留本机”（不删原件）与
  “删除”（独立确认）；本机救援包（ZIP + SHA-256 清单、防篡改/路径穿越/
  解压炸弹、恢复默认仅本机）。
- **M5/M6 运维工具**：`scripts/ops/ftc` + install/deploy/status/doctor/
  setup-info/logs/stop/start/backup/restore/upgrade/rollback/cleanup 与共享库；
  两种部署模式（Caddy 自动 HTTPS / 环回 + Nginx 片段）；停写一致性快照；
  升级 A/B/C/D 失败分级；已接受写入后回退需显式数据决策；维护门禁 503。
- **测试**：根 12 项邀请/初始化集成 + mobile-sync 适配；mobile 151 项
  （新增 39 项：首启流程、授权门、本机详情、确认带编辑、救援包往返、
  邀请解析）；运维 12 项（真实 bash + 假 docker：幂等、端口审计、快照
  校验/篡改、清理 dry-run、锁互斥与自动回收、A 类失败、回退拒绝）；
  CI 新增 ops-quality（ShellCheck error 级 + test:ops）。

## 版本

- 包版本 1.3.0-alpha.1（root/mobile 一致）；原生展示版本 1.3.0；
  buildNumber/versionCode = 11（在 10 基础上递增）。
- 数据库迁移 0040（instance_meta 表，可公开实例标识）。

## 已知边界与未验证项（如实记录）

- 本轮全部验证来自单测/集成/组件测试与 CI；**尚未在真实 VPS + 真机完成
  端到端演示**（两账号注册共享、离线重开、换家庭隔离、救援恢复、旧数据
  升级、迁移失败处理等场景的设备级证据待补）。
- ftc 工具用假 docker 测试；**真实 Docker 环境的 install/upgrade/backup
  实机演练待补**。支持平台先按脚本声明（Debian 12/13、Ubuntu 22.04/24.04
  x86_64），未经实测的 ARM/其他平台未承诺。
- 镜像 ghcr.io 发布与 digest 固定流程待 M7 发行阶段执行；当前部署示例
  使用 tag。
- Android 发行签名仍未固定（历史测试包为 debug 签名）；iOS 无证书，只能
  产出明确标注的 unsigned IPA。升级覆盖安装需同签名，构建号递增不能解决
  签名不兼容。
- 直接确认入档（有可信时间的一次性保存+确认）部分覆盖：收件箱确认已
  携带编辑；拍摄即确认的更短路径留待后续版本。
