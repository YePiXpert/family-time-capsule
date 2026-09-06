# 备份与恢复（1.3）

## 三种“备份”不要混淆

| 产物 | 内容 | 用途 | 敏感性 |
| --- | --- | --- | --- |
| 实例快照（`ftc backup`） | 数据库 + 原件 + 实例配置 + manifest/SHA256 | 本机误操作恢复、升级前快照、跨服务器恢复 | 高（含账号与 AUTH_SECRET），受保护保管 |
| 应用内完整 ZIP 导出 | 家庭资料 portable archive | 家庭迁移/阅读分享 | 见 docs/EXPORT_FORMAT.md |
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
引用可能错位）；1.3 选择明确停机的正确性优先。在线 `VACUUM INTO` 仍是
可用的补充手段（应用内 Web 备份页）。

**同 VPS 快照 ≠ 异地备份。** 请继续用现有 WebDAV/导出能力，或把快照
拷贝到另一台设备（`scp backups/ftc-snapshot-*.tar.gz elsewhere:`）。

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
