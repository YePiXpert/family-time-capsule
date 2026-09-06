# 探索期版本 → 正式 1.0 升级说明

> 本文是 M0-V 版本归一化的迁移文档。目标:任何探索期安装都能安全升级到
> 正式 1.0.0 主线;工具不会把这次升级误判为"降级",也不会放行任何回退。

## 1. 适用范围

你正在运行以下任一探索期版本(全部为 prerelease,均未通过正式发布门禁):

| 版本 | tag | ghcr 镜像 | 说明 |
| --- | --- | --- | --- |
| 0.1.0 ~ 0.1.3 | v0.1.x | 部分 | P0 可信时间线 → 性能与审计加固 |
| 1.0.0-rc.1 / rc.2 / rc.4 | v1.0.0-rc.N | 有 | Family Archive 候选(探索期 rc,非正式 1.0) |
| 1.0.0-rc.3 | 无 | 无 | 仅 CHANGELOG 记录 |
| 1.1.0-alpha.1 | v1.1.0-alpha.1 | 有 | Capture Anywhere |
| 1.2.0-alpha.1 ~ 4 | v1.2.0-alpha.N | 有 | 家庭记忆馆与成长年册 |
| 1.3.0-alpha.1 | v1.3.0-alpha.1 | 有 | 从部署到全家使用 |

以上版本在发布注册表中标记为 `era: exploration`。

## 2. 升级路径(唯一)

```
任何探索期版本 ──ftc upgrade──▶ 1.0.0-dev.N / 1.0.0-rc.N / 1.0.0（正式主线）
```

- **数据库**:无需手工转换。探索期与正式主线共享同一条迁移链
  (`db/migrations/0000 → 00NN`,编号连续、只增不改历史);升级时新版本
  自动前滚迁移。
- **数据卷**:不变。`capsule-data` 卷、`/data/db`、`/data/originals`
  原样保留;`AUTH_SECRET`、初始化状态不重置,不会出现"空家庭"。
- **归档兼容**:正式 1.0 保留对探索期导出 ZIP 的恢复能力
  (`npm run verify:export` + restore 套件覆盖 0.1.3 / rc.4 / 1.1 / 1.2 归档)。

## 3. 工具如何识别这次"特殊"升级

`ftc upgrade` / `ftc deploy` 的判定全部基于
[`scripts/ops/lib/releases.json`](scripts/ops/lib/releases.json) 与
`release_tool.py`:

1. 目标镜像带 tag → 按 tag 在注册表中解析版本;**digest 固定引用必须加
   `--version <注册表内版本>`**,否则拒绝(错误码 26)——工具从不从
   digest 截取版本。
2. `transition --from <当前> --to <目标>`:
   - exploration → formal:**允许**(本文描述的合法路径);
   - formal → exploration:**拒绝**("探索期已结束");
   - formal 内部 sequence 回退:**拒绝**(数据回退走 `ftc rollback`
   的显式数据决策流程,不是版本升级);
   - stable → dev/candidate:**拒绝**,除非 `--allow-nonstable-target`。
3. 判定**不用** `sort -V` / SemVer 比较——按 SemVer,`1.0.0` 小于
   `1.3.0-alpha.1`,若按 SemVer 排序,探索版升正式 1.0 会被错误判定为
   降级而被阻止,或更糟:正式 1.0 升回探索版被判定为升级而放行。
4. 升级成功后部署记录写入 `channel=`;`ftc status` 可见通道从
   exploration 变为 development/candidate/stable。

## 4. 操作步骤

```bash
# 1. 只读查看计划(确认版本与通道判定)
ftc upgrade --check

# 2. tag 引用直接升级(示例)
ftc upgrade --image ghcr.io/yepixpert/family-time-capsule:1.0.0-rc.5

# 2b. digest 固定引用必须声明版本
ftc upgrade \
  --image ghcr.io/yepixpert/family-time-capsule@sha256:<digest> \
  --version 1.0.0-rc.5

# 3. 失败处置(A/B/C/D 四类)见 docs/UPGRADE.md,不变。
```

## 5. 老脚本/旧清单的桥接

- 探索期的 `state/current_version` 值(如 `1.3.0-alpha.1`)在注册表中
  登记,升级工具能直接识别,无需手工改 state。
- 极老安装若无 `state/current_version`(早于部署记录机制的版本):
  `ftc upgrade` 会**拒绝并提示**,不允许在版本未知的情况下升级;
  按 `docs/OPERATIONS.md` 确认数据卷归属后,用 `ftc install --version`
  在新机上显式声明版本重新接管。
- 旧版本清单(如 hand-kept 的 env 注释)不含通道信息:一律以注册表为准。

## 6. 不会发生的事

- 不会删除、移动或改写任何历史 tag / GitHub Release / 附件;
- 不会重置 `AUTH_SECRET`、重建数据卷或重新打开 `/setup` 初始化;
- 不会因版本归一而重编号数据库迁移或导出格式(兼容承诺见
  docs/EXPORT_FORMAT.md);
- 正式 `v1.0.0` tag 发布前,任何工具输出都不得声称"stable 已发布"。
