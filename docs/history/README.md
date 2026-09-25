# 历史文档索引

这里存放已经完成的计划、审查和适配记录。它们保留当时的决策依据和现场证据；其中的版本、命令、路径、待办和「尚未部署」等说法，都只代表写下它们的那一天。

现在的情况看这几份：产品范围看 [PRODUCT](../../PRODUCT.md)，交付与待验看 [HANDOFF](../../HANDOFF.md)，结构与协议看 [ARCHITECTURE](../ARCHITECTURE.md)，真机验收看 [ACCEPTANCE](../ACCEPTANCE.md)，历次版本的行为变化看 [CHANGELOG](../../CHANGELOG.md)。

## 计划（`plans/`）

| 文件 | 时期 | 结果 | 后来撤回或取代的部分 |
| --- | --- | --- | --- |
| [PLAN-BUILD-56](plans/PLAN-BUILD-56.md) | Build 56 | 已交付 | 按天分组（1.0.3 撤回） |
| [PLAN-BUILD-60-61](plans/PLAN-BUILD-60-61.md) | Build 60–61 | 已交付 | 时光系列、年度重放、足迹（1.0.3 撤回） |
| [PLAN-BUILD-62-65](plans/PLAN-BUILD-62-65.md) | Build 62–65 | 已交付 | 年度长图、重放配乐、足迹（1.0.3 撤回） |
| [PLAN-BUILD-68](plans/PLAN-BUILD-68.md) | 2026-09-19 | 已交付为 Build 68 | 时光系列（1.0.3 撤回） |
| [PLAN-BUILD-69](plans/PLAN-BUILD-69.md) | 2026-09-19～20 | 已交付为 Build 69 | 系列、足迹、重放（1.0.3 撤回）；AI 设置页（1.1.1 取消） |
| [PLAN-BUILD-70](plans/PLAN-BUILD-70.md) | 2026-09-20 | 已交付为 Build 70 | 每位成员各一份远端（Build 72 改为家庭共享，1.1.0 改为按设备授权） |
| [PLAN-SHARING](plans/PLAN-SHARING.md) | 2026-09-21 | 已交付为 Build 72 | 用恢复码加入（1.1.0 改为扫码批准设备）；备份页「家人一起写」卡（1.1.4 改为家庭页同步卡） |
| [PLAN-BUILD-73](plans/PLAN-BUILD-73.md) | 2026-09-21 | 随 1.0.0 发布 | 安卓逐段同意（1.1.1 取消）；转写上游（现为 `mimo-v2.5-asr`） |
| [PLAN-FAMILY-DEVICES](plans/PLAN-FAMILY-DEVICES.md) | 2026-09-24 | 阶段一交付为 1.1.0 / 82 | 阶段二（撤销后钥匙轮换、远程配对）已延期；现行设计见 ARCHITECTURE |
| [PLAN-IOS-MOTION](plans/PLAN-IOS-MOTION.md) | 2026-09-24～25 | M0–M5 交付于 1.1.3，第九节交付于 1.1.4 | 第七节的原生待测项已并入 ACCEPTANCE |
| [PLAN-SETTINGS-REDUCTION](plans/PLAN-SETTINGS-REDUCTION.md) | 2026-09-25 | 已交付为 1.1.4 / 86 | 第五节的真机待看项已并入 ACCEPTANCE |

凡是计划里写到「家史」「时光系列」「足迹」「长图」「重放」「照片分组」「AI 看图写故事」「起个头」「写信引导」「出生的故事模块」的地方，都已经撤回，不能作为恢复这些功能的依据（见 PRODUCT「使用范围」）。

## 审查与适配

| 文件 | 时期 | 结果 |
| --- | --- | --- |
| [PROJECT-AUDIT](PROJECT-AUDIT.md) | 2026-09-21，Build 72 期间 | 19 项修复，1 项撤回（A-17） |
| [FINALIZATION-1.1.5](FINALIZATION-1.1.5.md) | 2026-09-25 | 1.1.5 冻结前收尾，24 项修复，交付后补了 35 条回归 |
| [MIMO-ADAPTATION](MIMO-ADAPTATION.md) | 2026-09-21～24 | 文字模型改用 GPT-6 Astra 后取代；只有语音转写沿用 MiMo |

PROJECT-AUDIT 里写成「还没做」的事项，后来的处理结果：

- 「这一批改动还没有提交」「服务端改动要部署才生效」：已在 `306cee2`、`cebfe13`、`f71f86c` 提交，服务端同日部署。
- 「Build 72 还有提交 11–15 没做」：Build 72 已在 `7cdc42d` 交付。
- `app.ts` 用 tmpfs 兜底 `BackupStore`，以及 `backup_object_claims` 没有每设备上限：`8a27c6a` 把 `BackupStore` 改为必填，并加了每设备的 claim 上限。
- `SHARED` 提示词仍是旧版：已随 1.0.0 按 [AI 说明](../AI-PROMPTS.md) 重写，由 `server/tests/prompts.test.ts` 逐字核对。
- 第五节列出的真机与双机验收：仍未完成，统一记在 [ACCEPTANCE](../ACCEPTANCE.md)。
- 引用的 `README.md:65`、`CPA_BASE_URL`／`CPA_KEY_FILE` 等是当时的行号和变量名；现行变量见[部署指南](../../deploy/README.md)。

## 维护

- 新的计划写完、交付或放弃之后，移到这里，第一行下面加上一行「历史记录」横幅，并在本表登记一行。
- 不要回头改历史文件的正文，改动只加在横幅和本索引里。
