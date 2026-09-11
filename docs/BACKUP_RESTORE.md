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
连同 `config/env`、manifest（格式版本/镜像标识/内容类别）写入临时文件 →
核验整包 SHA-256、SQLite 完整性和外键、所有已登记原件的长度与 SHA-256 →
通过才发布 `backups/ftc-snapshot-<id>.tar.gz` + `.sha256` →
自动重启服务。保留最近 `FTC_BACKUP_KEEP`（默认 5）份，永不删除最后一份。
损坏或缺件的新快照不会进入保留列表，也不会淘汰已有快照；失败会尝试重启服务。

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

工具先在目标同一文件系统的私有临时目录完成解包、SQLite 完整性/外键检查和
全部登记原件的长度/SHA-256 检查，再原子发布目标目录。绝对路径、路径穿越、
符号链接、特殊文件、重复条目和指向归档外的硬链接均拒绝；合法归档内硬链接
按普通文件复制。目标须不存在或为当前执行用户拥有的空目录，不能是符号链接。
校验需要额外空间容纳快照私有副本、未压缩 `data.tar` 与解包数据；失败不产生半恢复目标。

恢复保留账号、密码、停用状态、内容归属、读者范围、日期和快照内的删除记录；
清除旧 session/verification，轮换同步 generation 并清除旧游标，撤销访客链接与
邀请链接。手机须重新登录并完整同步。原始配置只保存在权限为 600 的
`config/env.snapshot`，不会被执行或自动用于启动。**保留原 AUTH_SECRET**，
它用于解密已启用的两步验证资料；不能直接换成新随机值。

### 仅在本机隔离启动验证

编辑恢复目录的 `config/env`，显式填写以下字段：

- `AUTH_SECRET`：原实例密钥（从受保护的原配置中核对，不要 `source env.snapshot`）。
- `FTC_RESTORE_IMAGE`：已核验来源、与该快照版本兼容的镜像，建议固定 digest。
- `FTC_RESTORE_DATA_DIR`：恢复目录中 `data` 的绝对路径。
- `FTC_RESTORE_UID` / `FTC_RESTORE_GID`：该数据目录所有者的数字 UID/GID。
- `FTC_RESTORE_PROJECT`：全新的独立 Compose 项目名；`FTC_RESTORE_PORT`：未占用本机端口。

在仓库目录执行：

```bash
sudo docker compose --env-file /opt/ftc-restore-test/config/env \
  -f scripts/ops/templates/compose.restore-check.yml up -d --wait
# 使用 http://127.0.0.1:<FTC_RESTORE_PORT> 核对；远程机器可通过 SSH 端口转发访问。
sudo docker compose --env-file /opt/ftc-restore-test/config/env \
  -f scripts/ops/templates/compose.restore-check.yml down
```

模板只将网关绑定到 `127.0.0.1`。应用位于无外网出口的内部网络，网关没有数据卷
或密钥，只转发到应用的固定端口；不启动 worker，不带入原 WebDAV/AI 配置。
应用需要读写恢复目录以运行数据库迁移和登录。`ftc install` 会拒绝此恢复目录，
避免另建空数据卷而误以为已使用恢复数据。

`restore-report.json` 记录原件数量/字节数、失效会话及链接数量和校验摘要。
其中 `postSnapshotRevocationsReconciled: false` 表示**快照之后的停用、撤权或
删除尚未对账**。隔离验证通过不代表可以接回公网或原手机；正式接管仍需完成
这部分对账、域名/凭据复核和实际部署验收。当前工具不自动切换生产。

仓库的 `scripts/verify-instance-snapshot.mts` 使用合成家庭数据，实际启动 Docker
app/worker，执行 `ftc backup` / `ftc restore`，再启动独立恢复应用，验证真实登录、
私密/指定成员/家庭读取、正文与日期、照片和音频原件、删除状态、旧会话/链接/同步游标
失效，以及原实例在备份后的修改保持独立。它不访问真实家庭实例。

## 面向家庭的 portable 档案

与实例快照不同：先在新实例完成管理员初始化，再走应用内恢复流程把家庭
资料导入并重新绑定（见 docs/RESTORE.md）。两者不可互换使用。
