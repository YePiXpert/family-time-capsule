# 结构与协议

这份文档说明代码现在是怎么组织的：模块边界、本机数据、家庭钥匙、同步协议和服务端接口。产品取舍看 [PRODUCT](../PRODUCT.md)，界面规则看 [DESIGN](../DESIGN.md)，额度与部署数字看[部署指南](../deploy/README.md)，AI 输入看 [AI 说明](AI-PROMPTS.md)。设计推导过程在 [PLAN-FAMILY-DEVICES](history/plans/PLAN-FAMILY-DEVICES.md) 等历史文档里。这里只写现状；代码改了，这份文档要一起改。

## 仓库与模块边界

| 路径 | 职责 |
| --- | --- |
| `mobile/src/local/` | 本机资料库、页面、编辑、阅读、备份、开放归档、纸书与 PDF。**不联网，不读家庭凭据**。 |
| `mobile/src/family/` | 家庭、设备、配对、恢复码与家庭页面；只有 `api.ts` 联网。 |
| `mobile/src/sync/` | 加密、清单、三方合并、冲突留底、自动同步与同步卡；只有 `transport.ts` 联网。 |
| `mobile/src/ai/` | AI 任务、面板与结果状态；只有 `client.ts` 联网。 |
| `mobile/modules/`、`mobile/plugins/` | 原生模块（分享接收、系统语音识别）与 Expo 配置插件（iOS 分享扩展）。 |
| `mobile/scripts/` | 边界检查、冒烟与回归脚本、测试夹具（Python）。 |
| `server/` | 一个家庭一台的 Fastify 服务：设备鉴权、密文对象库、AI 代理与额度（Node 24 原生运行 TypeScript，SQLite）。 |
| `deploy/` | Compose、环境示例和 SQLite 备份脚本。 |
| `.github/workflows/` | `ci.yml` 日常门禁；`mobile-build.yml` 出 APK／未签名 IPA，跑原生回归，打标签时发布 Release。 |

`mobile/scripts/verify-local-boundary.py` 在 CI 里检查这些规则。检查范围是 `src`、`App.tsx`、`index.ts` 和 `modules/*/src` 里的全部 TS／JS 文件；网络调用按标识符匹配，换名导入、`expo/fetch`、文件系统下载都算，`import()` 和 `require()` 也算引入：

- 只有上面三个文件可以联网；
- `src/local` 不读钥匙串里的家庭凭据；
- `src/sync` 和 `src/ai` 不引入本机页面组件（`ui`、`context` 除外）；
- 服务地址只在 `mobile/src/local/brand.ts` 里出现一次。

## 本机数据

- **资料库**：`LocalStore`（`local/store.ts`）把整库 `Library`（`local/model.ts`）存进 expo-sqlite。所有写入（包括恢复）都排在同一个队列里，写入失败不会推进界面状态。实体一旦存下就不可变，修改时整条替换。共享实体有这几类：`records`、`albums`、`series`、`persons`、`letters`，以及 `yearNotes`、`yearCovers`、落款等根字段。`drafts`、`selections` 和本机设置只留在这台手机上。
- **素材**：照片、录音、文件按 sha256 放在本机 blob 库里，另有持久缩略图。
- **备份格式**（`local/backup-format.ts`）：
  - v1 `XIAOMEI1`：只读兼容。
  - v2 `XIAOMEI2`（`.xmb`）：meta、实体 NDJSON 加去重后的素材字节，单卷超过 2 GiB 就分卷。这是导出到手机之外的完整备份。
  - v3 `XIAOMEI3`（`.xmbm`）：只有清单不带素材，素材在 blob 库里。用于本机保留的三份备份和同步清单。
- **开放归档**（「导出可阅读副本」）：一个 ZIP，里面是 Markdown、原文件和离线网页，脱离 App 也能读，不能用来恢复。
- **钥匙串**（SecureStore，仅本机、解锁后可读）：设备令牌、X25519 设备私钥、家庭内容钥匙 K。它们都不进 `Library`，也不进任何备份（键名见 `brand.ts`）。

## 家庭与设备

一台服务只有一个家庭。成员（家人）和设备分开管理；角色只有管理者和家人。没有用户名和密码，每台设备凭自己的令牌访问，服务端只存令牌的哈希。

- **开家庭**：部署端用 `manage.ts activation` 生成一次性激活码，第一位管理者的手机凭它创建家庭（`POST /family/activate`）。
- **家庭内容钥匙 K**：由创建家庭的手机生成，16 字节，指纹为 `keyId`。K 只存在已获准设备的钥匙串里。
- **加手机（当面扫码）**：
  1. 新手机登记申请，提交设备公钥和 `claimHash`，然后出示二维码。二维码里有申请号、公钥和一次性秘密 S。
  2. 管理者扫码，先核对服务端返回的公钥与二维码里的一致，再选择「新增一位家人」或「给已有家人加手机」。
  3. 管理者用 RFC 9180 HPKE（X25519／HKDF-SHA256／ChaCha20-Poly1305，PSK 模式，PSK 就是 S）把 K 封给新手机。`info` 绑定家庭和申请，AAD 绑定成员、角色、设备、批准者、钥匙指纹和过期时间。
  4. 新手机取回钥匙包（`collect`），解开并逐项核对，存好令牌和钥匙以后再 `confirm`。
  
  服务端没有 S，所以伪造不出能被解开的钥匙包。申请和确认的时限见部署指南。
- **恢复码**：恢复秘密 R 是 16 字节随机数，和 K 相互独立，显示成 12 个 BIP39 英文词，只抄在管理者的纸上，手机和服务器都不存。由 R 经 HKDF 分出两样东西：
  - `proof`：服务端只存它的哈希，用来核对恢复请求。
  - `wrap`：用 XChaCha20-Poly1305 封 K，得到恢复包，AAD 绑定家庭、钥匙指纹和恢复版本。

  拿到 `proof` 推不出 `wrap`，所以服务端解不开恢复包。所有管理者手机都丢了时，用 `POST /recovery/claim` 找回；只有真的解开远端最新那份清单才算找回成功。重新生成恢复码时，手机先显示新的一套、让管理者抄写并核对，然后才提交；提交成功，旧的立即作废。响应丢了可以原样重交，服务端当作成功。
- **停用与退出**：管理者可以停用设备；设备一年没用自动失效；最后一台有效的管理者设备不能停用，也不能退出。「退出这个家庭」会作废本机令牌、撤下这台设备的清单、清掉本机的钥匙与凭据。只有服务端确认之后，本机才清除这些东西。已经下载到别的手机上的内容收不回来。

## 同步

远端只是本机清单的密文副本（`sync/engine.ts`、`sync/family.ts`）。

- **加密**（`sync/crypto.ts`）：素材切块，用 XChaCha20-Poly1305 加密。对象 id、子钥和 nonce 都由 K 和内容哈希经 HKDF 派生，所以同一份内容永远得到同样的 id 和密文，可以断点续传、多台共享去重。服务端只看得到对象 id 和密文长度。清单索引很小，封成 `ANANSML1` 格式，服务端只多存一个 `keyId`，这样钥匙不对时，在下载任何对象之前就能判出来。
- **发布**：每台设备发布自己的一份清单。发出去的库去掉草稿，素材只带共享实体用到的（`sharedLibrary`）。先问服务端缺哪些对象（`have`），只传缺的，最后传清单。
- **合并**（`sync/merge.ts`，纯函数）：读别的设备的清单，按实体做三方合并。
  - 合并基有两样：`merged` 是上次同步结束时本机各实体的指纹；`known` 是本机处理过的其他版本，防止旧清单把已经删掉或改掉的内容送回来。
  - 两边都改过的，`updatedAt` 新的一版胜出，输的一版留底进冲突页。
  - 删除用墓碑表示。相册和系列的条目取并集，同名人物自动并成一个。
  - 合并后先修好引用再入库；补落款不改正文的修订时间。
- **冲突**（`sync/conflicts.ts`）：「用这一版」把留底存成新版本；「知道了」只移除留底。冲突页与同步互斥。
- **互斥与自动同步**：本机备份、恢复、归档和同步共用一个互斥状态。已加入家庭并开着自动同步时，回到应用、保存后 30 秒各同步一次；暂时的网络错误下次再试。
- **服务端回收**：对象全家共享、先到的为准。这几样都会保护对象不被回收：所有清单登记的对象、48 小时的上传占位、一小时宽限期。只要有一份清单的引用未知，整轮回收就跳过。停用设备不删它的清单。

## AI

手机只通过 `ai/client.ts` 调用 `/api/v1/ai/*`。文字任务有五种：`polish`、`recap`、`ask`、`question`、`editor`。服务端用 `server/src/prompts.ts` 拼好提示词再交给上游，结果在服务端校验通过才返回；请求里带照片会被拒绝。转写端点收 m4a，服务端用 ffmpeg 转码后送去转写。手机端有本机识别时优先用本机。每项任务具体送什么，以 [AI 说明](AI-PROMPTS.md) 为准；模型、额度、缓存与时限见部署指南。

## 服务端接口

所有路由都在 `server/src/app.ts`，前缀 `/api/v1`（`/healthz` 与 `/` 除外）。鉴权一栏的含义：匿名接口按地址和全局限流；「设备」要求 `Authorization: Bearer <设备令牌>`；「管理者」要求设备令牌属于管理者。

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| GET | `/healthz` | 匿名 | 健康检查与 `SOURCE_SHA` |
| GET | `/` | 匿名 | 说明页 |
| GET | `/status` | 匿名 | 是否已初始化、是否已有家庭 |
| POST | `/family/activate` | 匿名＋激活码 | 开家庭，登记第一位管理者和设备 |
| POST | `/family/upgrade` | 管理者 | 1.0.8 的管理者手机升级到家庭模式 |
| GET | `/family` | 设备 | 家庭、我是谁、成员名单 |
| POST | `/pair/requests` | 匿名 | 新手机登记配对申请 |
| GET | `/pair/requests/:id` | 管理者 | 扫码后读取申请（核对公钥） |
| POST | `/pair/requests/:id/approve` | 管理者 | 批准并上传 HPKE 钥匙包 |
| POST | `/pair/requests/:id/collect` | 匿名＋claim | 新手机取回钥匙包与令牌 |
| POST | `/pair/requests/:id/confirm` | 设备 | 新手机确认已存好 |
| POST | `/pair/requests/:id/cancel` | 管理者，或匿名＋claim | 取消申请 |
| POST | `/recovery/claim` | 匿名＋恢复证明 | 核对恢复码、列出管理者；第二步登记新设备 |
| PUT | `/admin/recovery` | 管理者 | 换新的恢复包（重新生成恢复码） |
| GET | `/me` | 设备 | 我是谁与今日用量 |
| POST | `/me/leave` | 设备 | 这台设备退出家庭 |
| GET | `/ai/config` | 设备 | 模型与暂停状态 |
| POST | `/ai/write` | 设备 | 五种文字任务 |
| POST | `/ai/transcribe` | 设备 | 录音转写 |
| GET | `/backup/status` | 设备 | 对象库用量、配额、最新清单 |
| POST | `/backup/objects/have` | 设备 | 问缺哪些对象，同时登记上传占位 |
| PUT | `/backup/objects/:id` | 设备 | 上传一个密文对象 |
| GET | `/backup/objects/:id` | 设备 | 下载一个密文对象 |
| PUT | `/backup/manifest` | 设备 | 发布这台设备的清单索引与对象列表 |
| GET | `/backup/manifest` | 设备 | 这台设备（或同一成员最新）的清单 |
| GET | `/backup/manifests` | 设备 | 全家有效设备的清单，同步时用来合并 |
| DELETE | `/backup/manifests/:deviceId` | 设备（自己的）／管理者 | 撤下一份清单 |
| POST | `/backup/prune` | 设备 | 回收没人引用的对象 |
| DELETE | `/backup` | 设备 | 撤下这位成员名下的清单（旧版手机用） |
| GET | `/admin/overview` | 管理者 | 成员、设备、用量、对象库总览 |
| PUT | `/admin/members/:id/profile` | 管理者 | 改称呼与角色 |
| PATCH | `/admin/members/:id` | 管理者 | 启用／停用成员，调额度 |
| DELETE | `/admin/members/:id/backup` | 管理者 | 撤下一位成员的全部清单 |
| DELETE | `/admin/backup` | 管理者 | 删掉全家的远端（清单和对象） |
| DELETE | `/admin/devices/:id` | 管理者 | 停用一台设备 |
| PUT | `/admin/settings` | 管理者 | AI 暂停与全家额度 |

错误统一返回 `{code, message}`，其中 `message` 是给家人看的中文。所有响应都带 `Cache-Control: no-store`。

另有部署端的命令行：`server/src/manage.ts`（`activation`、`promote`、`ai …`、`backup`、`wipe-backup family`），见[部署指南](../deploy/README.md)。
