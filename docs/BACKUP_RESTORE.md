# 备份与恢复

## 三种“备份”不要混淆

| 产物 | 内容 | 用途 | 敏感性 |
| --- | --- | --- | --- |
| 实例快照（`ftc backup`） | 数据库 + 原件 + 实例配置 + manifest/SHA256 | 本机误操作恢复、升级前快照、跨服务器恢复 | 高（含账号与 AUTH_SECRET），受保护保管 |
| 应用内 ZIP 导出 / WebDAV 副本 | 当前账号有权导出的家庭资料 portable archive | 授权范围内的资料保全、迁移 | 含私人资料；不等于适合公开分享，见 docs/EXPORT_FORMAT.md |
| 手机本机救援包 | 未同步的本机记录 + 原件 + 哈希清单 | 换机/重装前的本机资料保全 | 中（不含凭据） |

实例快照未加密存储时不承诺端到端加密；不要当作普通阅读包分享。

## 快照（停写一致性）

```bash
sudo bash scripts/ops/ftc backup                    # 生成 + 自动校验
sudo bash scripts/ops/ftc backup verify <快照.tar.gz>  # 任意时候复验
```

流程：停止 app/worker（维护门禁期间对外 503）→ 用应用镜像打包数据卷 →
连同 `config/env`、manifest（版本/镜像 digest/文件清单）写入
`backups/ftc-snapshot-<id>.tar.gz` + `.sha256` → 校验通过才报成功 →
自动重启服务。保留最近 `FTC_BACKUP_KEEP`（默认 5）份，永不删除最后一份。

为什么停写：SQLite 在线直接 `cp` 主库文件不是一致备份（WAL/事务与媒体
引用可能错位）；当前实例快照通过停写保持数据库与媒体一致。应用内 WebDAV
页生成 portable ZIP，不提供全实例在线数据库快照。

**同 VPS 快照 ≠ 异地备份。** 全实例保全需要把快照和对应 `.sha256` 文件
复制到独立设备或独立故障域的存储，妥善保护其中的账号与配置。
WebDAV 使用 `buildActorExport`，会过滤当前账号无权读取的私密资料，不能代替全实例副本。

## WebDAV 副本的成功条件

在部署使用的环境文件中填写 `WEBDAV_URL`、`WEBDAV_USERNAME`、`WEBDAV_PASSWORD`，
可用 `WEBDAV_DIRECTORY` 指定已创建的目标目录。仓库的三份 Compose 配置只把这些
参数传给 app；修改后需重新创建 app 容器，单纯刷新页面不会更新容器环境。

每次运行生成独立路径：上传临时文件 → 回读核对字节数和 SHA-256 → MOVE →
回读最终路径并再次核对，全部通过才记录成功。只有 MOVE 返回 405/501 时降级为
直接上传；重定向、权限错误或服务器错误均失败。直接上传的最终校验失败时保留
已验证的临时副本，不自动删除已有备份。远端保留策略尚未接入本机 cleanup。

`WEBDAV_REQUEST_TIMEOUT_MS` 默认 600000（10 分钟），限制每一次 HTTP 上传或回读，
包含响应正文传输。大档案和慢速网络应按容量调整；最终路径额外回读会增加网络流量。
卡住的传输记录 `webdav_timeout`，其他失败记录阶段/HTTP 状态或固定错误码，
不保存异常原文中的凭据和私人文件名。运行记录不能代替恢复演练。

## 自动化边界

[OPERATIONS.md](OPERATIONS.md#systemd-定时备份可选显式开启) 已提供宿主机 systemd
定时实例快照示例，默认不启用。当前没有应用 worker 的全实例自动异地备份、
周期原件巡检或备份超期告警；`backup_run` 记录的是 WebDAV 运行，不能证明 systemd
已运行或所有用户的私密原件已覆盖。进程被强制终止后的 running 状态也尚无自动回收。

## 恢复（默认到全新空目标，绝不覆盖生产）

```bash
sudo bash scripts/ops/ftc restore <快照.tar.gz> --to /opt/ftc-restore-test
```

先整包校验（SHA256、tar 完整性、manifest、路径穿越检查），全部通过才
解压到目标；目标必须为空。恢复出的目录含账号状态与原实例配置
（`BETTER_AUTH_URL` 等）——跨服务器恢复时请人工核对新域名后再启动。
验证无误后可将其作为新 `FTC_ROOT` 启动，或映射为新数据卷。

## 面向家庭的 portable 档案

与实例快照不同：先在新实例完成管理员初始化，再走应用内恢复流程把家庭
资料导入并重新绑定（见 docs/RESTORE.md）。两者不可互换使用。
