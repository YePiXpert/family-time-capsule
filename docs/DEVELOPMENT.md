# 开发与验证

工作流程以 [AGENTS.md](../AGENTS.md) 为准；产品和 UI 分别看 [PRODUCT](../PRODUCT.md)、[DESIGN](../DESIGN.md)。仅在 `main` 开发与交付。

## 本地启动与门禁

Node.js 24，手机依赖使用 Expo。iOS 安装包可由 GitHub Actions 构建；本机 Android 开发需要 Java 21 与 Android SDK。

```sh
cd mobile
npm ci
cd ../server
npm ci
cd ..
mkdir -p /var/tmp/anan-tests
(cd mobile && TMPDIR=/var/tmp/anan-tests npm test && npm run typecheck && npm run lint)
(cd server && TMPDIR=/var/tmp/anan-tests npm test && npm run typecheck)
python3 mobile/scripts/verify-local-boundary.py
python3 -m unittest discover -s mobile/scripts -p 'test_*.py'
```

手机开发服务：在 `mobile/` 运行 `npm start`；原生依赖变化需要重新构建。服务端没有 lint 命令。Mock 测试不调用付费模型，真实探针见 [部署指南](../deploy/README.md)。

## 代码入口与边界

| 路径 | 职责 |
| --- | --- |
| `mobile/src/local/` | 本机资料、页面、备份、归档和纸书；禁止联网与读取家庭凭据 |
| `mobile/src/family/` | 家庭、设备、配对、恢复；仅 `api.ts` 联网 |
| `mobile/src/sync/` | 加密、清单、合并与同步；仅 `transport.ts` 联网 |
| `mobile/src/ai/` | AI 任务与结果；仅 `client.ts` 联网 |
| `server/` | 设备鉴权、密文存储、AI 代理和用量 |
| `.github/workflows/` | 日常 CI 与原生安装包构建 |

手机唯一服务地址在 `brand.ts`，部署与上游值留在私有配置。家庭钥匙不进入 Library 或普通备份；恢复秘密不持久化。加密协议设计见 [家庭与设备](plans/PLAN-FAMILY-DEVICES.md)。

## 易错约束

- 本机实体被冻结，修改时替换整个实体。新增实体种类同步更新校验、归档、引用收集、合并和 `local_fixture.py`；不能因删除页面而拒读旧备份种类。
- 同步需要同时记录合并基与已处理版本 `known`，避免旧清单复活内容；合并后修复引用再入库。补落款不更新正文修订时间。
- 恢复与同步共用互斥状态；恢复途中取消不能改动当前资料。远端恢复的临时保留文件保护原件，但不进入普通备份列表。
- 凭据只有在服务确认退出后才清除。授权与配额可能在上传／转码等待中变化，要在提交或付费调用前再次检查。
- 服务端 TypeScript 由 Node 原生剥离类型，不使用参数属性。Fastify 4xx 原样保留；二进制流需自行检查声明长度和实收上限。
- 家庭对象回收保护所有清单、上传占位和宽限期；任一清单引用未知时跳过整轮回收。停用设备不删除它的备份。
- 原生随机使用 `expo-crypto`；Hermes 不保证 Web Crypto。手势回调调用链中的函数需要 `worklet`。
- iOS 纸书取图按视图点数，Android 按目标像素；屏外舞台按 `captureGeometry`。素材表的宽高可能是缩略图尺寸。
- `File.move` 需要 await，同步路径用 `moveSync`。原生假件在 `tests/helpers/`；动态重载后的错误类用 name/code 断言。
- 隐藏原生页头后，返回按钮由 `Page` 提供。键盘、Safe Area、液态玻璃和大字规则见 DESIGN；首次录音等系统服务的 CI 超时须允许冷启动。
- 改流水线门禁时同时检查 `ci.yml` 和 `mobile-build.yml`；手机端到端测试需要安装服务端依赖。
- 提示词的六个 text 块与 `server/src/prompts.ts` 逐字对应，测试会检查。模型配置变更不应顺带改提示词。

## 安装包

版本与构建号规则见 [VERSIONING](../VERSIONING.md)。使用完整 40 位 main SHA；先查询该 SHA 的现有构建，复用可用的任务／产物。轻量 `v*` 标签会自动构建并发布，不再重复派发。

```sh
# 无可用构建且只做验证包时：
gh workflow run mobile-build.yml --ref main -f source_sha="$SOURCE_SHA"
```

跟踪策略见 AGENTS：仅 Fable 默认不轮询；其余模型跟踪到结束。日常提交不轮询 CI。

交付前核对全部必需作业、build-source.json 的完整 SHA、APK/IPA 原生版本、Release 校验和及原生回归报告；iOS 主应用和分享扩展版本必须一致。构建成功不等于两台真机验收。

## 文档维护

README 放使用入口；HANDOFF 只记当前版本、部署、验证和待办；CHANGELOG 记版本行为；部署指南只写可复用步骤。不要把会话流水账或旧发布哈希堆回首页。

`docs/plans/`、`PROJECT-AUDIT.md` 与 MiMo 适配记录是历史设计证据，其中的旧状态、命令和待办不作为当前操作依据。当前范围与状态以 PRODUCT、HANDOFF 为准。
