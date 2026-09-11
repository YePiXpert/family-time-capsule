# 升级与回滚

`ftc upgrade` 和 `ftc deploy` 使用同一条部署流程。每次升级分配新数据卷，旧卷在迁移和候选验证期间保持不变。

```text
注册表/磁盘预检 → 拉取并固定镜像身份
→ 停止 app/worker → 一致性快照（保持停止）
→ 复制到新卷 → 无网络、无公开端口、无 worker 的候选 app
→ 候选健康检查通过 → 停止候选进程
→ 原子更新镜像+卷 → 记录可能接受写入 → 强制重建正式容器
```

候选 app 的真实健康接口会打开数据库并执行迁移。正式启用必须强制重建容器：只改变 Compose 顶层卷的 `name` 不一定改变服务配置哈希，复用容器可能继续挂载旧卷。app/worker 始终使用同一固定镜像。

## 执行升级

```bash
sudo bash scripts/ops/ftc upgrade --check --image <已登记版本镜像>
sudo bash scripts/ops/ftc upgrade --image <已登记版本镜像>
# digest 或本机已有的 sha256 内容 ID 必须显式声明注册表版本
sudo bash scripts/ops/ftc upgrade --image <image@sha256:digest> --version <版本>
```

stable 离开正式通道仍需 `--allow-nonstable-target`。提交 main 不会自动部署生产。

维护窗口覆盖快照、完整数据复制、迁移及验证，期间服务不可用。至少保留 2GB 的预检门槛不代表大档案只需要 2GB：磁盘还须容纳快照、解包/复制中间结果和一份完整新卷。旧卷、失败候选卷和快照不会为腾空间而被自动删除；候选卷带有 `app.familytimecapsule.project` 归属标签。

## 失败处理

| 阶段 | 行为 |
| --- | --- |
| 拉取/预检失败 | 旧服务继续运行 |
| 快照或候选复制失败 | 尝试恢复原镜像与未迁移原卷；保留失败现场 |
| 候选迁移/健康检查失败 | 停掉隔离候选，尝试恢复未被候选打开的原卷；不把旧代码放到迁移后的候选卷上 |
| 正式容器开放时失败 | 停止 app/worker，保留新镜像与新卷配置；可能已经接受写入，禁止自动切回旧卷 |

正式开放失败后先检查 `ftc doctor`、日志与 `state/phase`；排障后 `ftc start` 会使用当前配对配置。启动等待有 90 秒上限。候选启动日志保存在受保护的 `logs/ftc-check-*.log`。`state/upgrade_snapshot`、`upgrade_source_volume`、`upgrade_candidate_volume` 记录本次升级的恢复线索。

## 快照回滚：准备、核对、启用

直接用旧镜像打开当前库不再是受支持的回滚方式。快照必须和历史部署的版本、镜像配置配对，并携带不可变镜像引用；原 AUTH_SECRET 必须一致。

```bash
sudo bash scripts/ops/ftc rollback --to <旧部署ID> --snapshot <快照文件名> --accept-data-loss
```

准备阶段先保存当前状态，再恢复到新的隔离目录。**退出 28 表示等待核对，尚未启用**，不会报告回滚成功，也不会启动旧镜像使用当前卷。此时 app/worker 保持停止；`start`、普通 `backup`、升级和 AI 配置变更会拒绝重新开放服务。额外备份可使用 `backup --keep-stopped`。

按输出中的目录和 [隔离恢复说明](BACKUP_RESTORE.md) 检查数据。对照当前状态快照，核对并在恢复目录中处理快照之后的账号停用、读者撤权、删除等决定。`--accept-data-loss` 仅接受资料时间点回退，不能代替访问权限核对。

```bash
# 完成上述核对和对账后，使用准备阶段输出的计划 ID
sudo bash scripts/ops/ftc rollback --activate <计划ID> --accept-data-loss --access-reviewed
# 或取消准备，重新启动未修改的原部署
sudo bash scripts/ops/ftc rollback --abort <计划ID>
```

启用时校验当前配置仍对应原计划，重新检查恢复数据与原件，撤销隔离核对期间产生的会话/链接，再复制到新的命名卷，运行隔离候选健康检查，通过后配对切换。原卷、故障卷、隔离恢复目录均保留。手机须重新登录并完整同步。

访问对账由操作员完成；报告中的 `reconciliationMethod: operator-attestation` 明确表示操作员确认，不冒充自动权限对账。启用过程中若正式启动失败，保留当时的配对配置和卷，不自动回到可能较旧的数据。已变化的当前配置不能继续启用或取消旧计划，需先人工核对现场。

所有会修改部署的 ftc 命令共用实例操作锁；嵌套备份/恢复继承同一把锁，其他命令不能在停写窗口中途重启服务。模拟故障覆盖脚本分支，`scripts/verify-deployment-lifecycle.mts` 在真实 Docker 中验证迁移后退出、实际卷切换、快照回滚和开放时 worker 失败。
