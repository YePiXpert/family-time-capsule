# 版本与通道策略（正式 1.0.0 主线）

> 本文自 2026-09-06 起生效。它解释一次**显式重新编号**：产品的最终正式版本是
> `1.0.0`,尽管历史上已经发行过 `1.1.0`~`1.3.0` 等更高数字的预发布。这不是
> 常规 SemVer 升级,是产品主线的重新锚定。

## 1. 为什么要重新编号

2026-08-29 至 2026-09-06 期间,仓库以 `0.1.x` → `1.0.0-rc.1~rc.4` →
`1.1.0-alpha.1` → `1.2.0-alpha.1~4` → `1.3.0-alpha.1` 的节奏发行了多个
**探索期预发布**。版本号增长反映的是提示词迭代的轮次,不是产品完成度;
这些版本从未通过正式发布门禁(真机验收、真实 VPS 演练、签名分发等),
也不应被工具当作"比 1.0.0 更新、更 stable"。

正式 1.0.0 主线把终点收敛为 `v1.0.0`:

- **历史不删除**:所有旧 tag、Release、附件、数据库迁移、原生 build number
  原样保留;探索期发行在发布注册表中标为 `era: exploration`。
- **主线重新锚定**:开发用未占用的 `1.0.0-dev.N`,候选用未占用的
  `1.0.0-rc.N`(rc.1~rc.4 已被探索期占用,正式候选从 **rc.5** 起),
  最终 stable 只有一个 `1.0.0`。

## 2. 必须如实说明的 SemVer 事实

按 SemVer 优先级比较:

```
1.0.0-rc.5  <  1.0.0  <  1.1.0-alpha.1  <  1.3.0-alpha.1
```

即:标准 SemVer 认为 `1.0.0` **小于**探索期 1.1/1.2/1.3 prerelease。因此:

- **禁止**用 `sort -V`、npm semver 比较或任何 SemVer 优先级判断
  "探索版 → 正式 1.0" 这条合法升级路径;
- 工具与文档不得声称"stable 1.0.0 是最高版本"——它不是,它是**主线终点**;
- 升级顺序的唯一依据是发布注册表的 `sequence` 字段(见 §4)。

## 3. 五条独立的版本轴

| 轴 | 含义 | 归一化规则 |
| --- | --- | --- |
| productVersion | 对外产品版本(root/mobile `package.json`、`expo.version`) | 终点 `1.0.0`;开发期 `1.0.0-dev.N` |
| releaseSequence | 发布注册表中的单调递增序号 | 探索期 1~14,正式主线从 15 起,永不回退、永不归零 |
| Android versionCode / iOS buildNumber | 原生包构建号 | 只增不减:当前 12(历史最高为 11);高于所有已发行构建 |
| DB migration 编号 | `db/migrations/00NN_*.sql` | 独立延续(当前至 0051),不因产品版本归一而归零 |
| API schemaVersion / 导出格式版本 | 协议与归档兼容承诺 | 独立延续;正式 1.0 不得破坏对探索期归档的恢复能力 |

`+build.N` 之类的 build metadata 不参与任何版本比较,也不能用来改变优先级。

## 4. 发布注册表(`scripts/ops/lib/releases.json`)

版本身份与通道的**唯一可信来源**。每条记录含 `version / channel / era /
sequence / tag / date`。工具规则:

1. **不从镜像引用截取版本**。`sed 's/.*://'` 在 digest 固定引用
   (`image@sha256:...`)上会产出 digest 尾巴伪版本——这是已知缺陷,已修复:
   digest 引用必须配 `--version`,且该版本必须在注册表中登记。
2. **不用 sort -V**。升级路径判定用 `release_tool.py transition`:
   - exploration → formal:允许(探索版升级到正式 1.0 主线);
   - formal → exploration:拒绝(探索期已结束);
   - formal 内部:目标 `sequence` 不低于当前(等号 = 一致性重装);
   - stable → 非 stable:拒绝,除非显式 `--allow-nonstable-target`。
3. **来源白名单**。未登记的版本一律拒绝安装/部署/升级,错误码 26。
4. 部署记录(`state/deployments/*.env`)写入 `channel=`,供 `ftc status` /
   `doctor` 展示与审计。

通道定义:

| channel | 谁能装 | 说明 |
| --- | --- | --- |
| exploration | 历史安装 | 0.1.x、1.x alpha、rc.1~rc.4;只出不进 |
| development | 开发者 | `1.0.0-dev.N`,日常 main 构建,不保证数据兼容承诺 |
| candidate | 主动试用者 | `1.0.0-rc.5+`,候选通道,过自动化门禁但未过外部门禁 |
| stable | 所有人 | 仅 `1.0.0`;全部发布门禁通过后登记、打 tag、发 Release |

## 5. 各处的版本读取方式

| 场景 | 正确来源 | 错误做法 |
| --- | --- | --- |
| `ftc` 工具自述 | `scripts/ops/VERSION` | — |
| 运行中服务版本 | 镜像内构建信息(`/api/bootstrap`、healthcheck) | 把脚本 VERSION 或镜像 sha256 当应用版本 |
| 升级目标判定 | 注册表 + `--version` | 从 `image@sha256:` 最后一个冒号截取 |
| 移动端展示版本 | `expo.version`(营销)/ buildNumber、versionCode(构建) | 用 versionCode 推断产品版本 |

## 6. GitHub Release 与 tag 纪律

- `v1.0.0` tag 只能在**全部发布门禁通过后**创建,指向 `origin/main` 上
  经过核验的确切提交,创建后不可移动;绝不替换已发布的附件。
- 含连字符的 tag(`1.0.0-dev.N`、`1.0.0-rc.N`)自动标记 prerelease;
  **不存在**"所有 `v*` 一律 prerelease"或"一律 stable"的规则。
- stable 发布前允许用 draft Release 准备产物,验证完成再公开。
- tag 必须先登记进注册表(CI 会校验),未登记的 tag 构建直接失败。

## 7. 历史版本 → 正式 1.0 的升级

见 [LEGACY_TO_1_0.md](LEGACY_TO_1_0.md):探索期所有版本沿数据库迁移链
(0000→00NN)自然前滚到正式 1.0,不需要任何数据手工转换;工具侧由注册表
白名单放行并记录通道变化。
