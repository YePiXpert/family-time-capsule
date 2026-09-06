# 运维手册（1.3）

`ftc` 是本项目的统一运维入口（`scripts/ops/ftc`）。它只操作本项目自己的
目录、容器、网络与卷；不触碰其他服务、不执行全机 prune、不改 SSH/防火墙。

## 目录布局

默认根目录 `/opt/family-time-capsule`（`FTC_ROOT` 可改）：

```
config/      env（0600：密钥与镜像版本）、initial-setup-token
releases/    current -> 本次部署的 compose/Caddyfile/nginx 片段
state/       phase（未完成阶段）、deployments/（部署记录）、locks/
backups/     ftc-snapshot-*.tar.gz + .sha256（实例快照，敏感）
logs/        预留
```

数据在 named volume `capsule-data`（`FTC_DATA_VOLUME` 可改）；同一安装
终身沿用同一卷，改目录名不会出现“空家庭”。

## 命令一览

| 命令 | 作用 | 关键保护 |
| --- | --- | --- |
| `ftc install` | 首次安装 / 二次只读检查 | 不覆盖已有数据与密钥；同名未确认卷拒绝 |
| `ftc status` | 版本、镜像摘要、容器、健康、磁盘、备份 | — |
| `ftc doctor` | 配置/端口审计/HTTPS/worker 只读探针/阶段残留 | 探针只读打开数据库 |
| `ftc setup-info` | 显示一次性初始化令牌 | 仅本机；不进 status/logs |
| `ftc backup` / `backup verify <f>` | 停写一致性快照与校验 | 见 BACKUP_RESTORE.md |
| `ftc upgrade [--check]` | 升级（预检→拉取→快照→迁移→验证→开放） | 见 UPGRADE.md |
| `ftc restore <f> --to <dir>` | 恢复到全新空目标 | 不覆盖生产 |
| `ftc rollback --to <id>` | 回退到历史部署 | 已接受写入时要求显式数据决策 |
| `ftc logs --service app\|worker\|proxy` | 脱敏日志 | 令牌/邀请路径自动打码 |
| `ftc stop` / `ftc start` | 停止/启动本项目 | 不删除卷 |
| `ftc cleanup [--apply]` | 清理超出保留数的旧快照 | 默认 dry-run；绝不删最后一份 |

所有变更型命令：互斥锁（进程死亡自动回收）、阶段状态文件（`state/phase`，
中断后 doctor 会提示）、非零退出码、`--help`。

## 安全边界

- `config/env` 0600；`.env` 不进仓库、不写镜像、不出现在诊断输出。
- 日志脱敏：`INITIAL_SETUP_TOKEN`、`AUTH_SECRET`、`token=`、
  `Authorization: Bearer`、`/invite/<token>`、`/contribute/<token>`。
- 代理默认不落访问日志（Caddyfile 未启用 access log）；若自建访问日志，
  请参考模板中的 `$ftc_loggable` 过滤。
- app 只在内部网络（caddy 模式）或 127.0.0.1（loopback 模式）可达；
  worker 无任何端口。
- 权限：容器以固定 UID 1001 运行；不要用 `chmod -R 777` 解决问题。

## 维护门禁

升级/备份的停写窗口内，`maintenance` profile 的 Caddy 以只读 503 对外，
防止用户在快照与迁移期间写入：

```bash
docker compose --profile maintenance up -d backup-hook   # 进入维护
docker compose --profile maintenance down                # 退出维护
```

## systemd 定时备份（可选，显式开启）

```ini
# /etc/systemd/system/ftc-backup.timer
[Unit]
Description=Family Time Capsule nightly snapshot
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/ftc-backup.service
[Unit]
Description=Family Time Capsule snapshot
[Service]
Type=oneshot
ExecStart=/bin/bash /opt/family-time-capsule/ftc-current/scripts/ops/ftc backup
```

（把 `ftc-current` 指向你固定的脚本副本；本仓库不默认启用任何自动任务。）
