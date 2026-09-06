# 升级指南（1.3）

升级不是 `git pull && docker compose up`。`ftc upgrade` 按以下顺序执行，
每一步失败都有明确定义：

```text
预检（锁、版本、磁盘 ≥2GB）        磁盘不足直接中止，绝不删旧备份腾空间
→ 拉取新镜像（旧版继续服务）        A 类失败：旧版未受任何影响
→ 维护窗口 + 停写一致性快照         快照失败（B 类）：恢复旧服务，不动数据库
→ 切换镜像并启动新版本（自动迁移）   启动失败（B 类）：回滚到旧镜像配置
→ 验证（health、app/worker 同镜像）  验证失败（C 类）：保持维护状态并给出
                                    快照回退与重试两条人工路径
→ 记录部署、开放写入               此后回退需显式数据决策（D 类）
```

## 只读预检

```bash
sudo bash scripts/ops/ftc upgrade --check          # 展示目标版本与停机说明
sudo bash scripts/ops/ftc upgrade --image ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1
```

维护窗口期间服务不可用（不承诺零停机）；预计时长 = 镜像拉取 + 数据打包
+ 迁移，取决于数据量。

## 通道纪律

- stable 不会自动升级到 alpha；prerelease 用户继续 prerelease 需显式指定
  `--image`。
- 生产默认使用已验证镜像（建议 digest 固定）；`main` 的每次 push 不会自动
  部署到任何生产实例。
- 未发布 commit 如需部署，属于显式开发部署，自行承担风险。

## 失败后的恢复路径

- **A（拉取失败）**：无需任何动作，旧版一直在运行。
- **B（迁移前失败）**：工具已自动恢复旧配置并重启；检查 `ftc doctor`。
- **C（验证失败）**：工具保持维护状态并打印两条命令：
  1. `ftc rollback --to <旧部署> --snapshot <升级前快照>`（丢弃迁移后数据库状态）；
  2. 排查后重跑 `ftc upgrade --image <目标镜像>`。
- **D（已开放接受写入后想回退）**：`ftc rollback` 会先生成当前状态快照，
  然后要求你明确二选一（保留新数据排障，或 `--accept-data-loss` 丢弃新
  写入回退到指定快照）。工具拒绝静默回滚数据库。

中断现场：`state/phase` 记录未完成阶段，`ftc doctor` 会报告并指向本文。
旧库、故障库与唯一媒体原件在任何路径下都不会被先删除。
