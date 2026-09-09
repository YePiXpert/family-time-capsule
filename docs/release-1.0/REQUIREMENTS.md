# 正式 1.0.0 需求清单(REQUIREMENTS)

> 状态口径(仅限以下七种):`待核验` `未实现` `部分实现` `自动化通过` `真实场景通过` `外部阻塞` `明确非产品范围`。
> 本清单是需求唯一 ID 来源;状态必须由真实代码/自动化/场景证据支撑,禁止"文件存在=完成"。
> 初始基线:2026-09-06,基于 acea745 探索报告 + 白皮书 1–29 章 + GOAL_FORMAL_1_0.txt。

## 2026-09-09 前端交付覆盖说明

本次已交付导航以「成长 / 成长册 / 我的 + 独立记录动作」为准，取代下表 NAV-1、NAV-3、NAV-7 的旧入口描述。
设计与视频修复的具体范围见 [成长手帐交付说明](../FRONTEND_JOURNAL.md)。
下方历史状态不代表此前讨论的全部产品重构已落地；真实设备状态仍独立验收。

## 状态统计（2026-09-08 P0 行为复核）

按下方有 ID 的实际需求行统计；自动化通过不代表真机、真实模型或正式发行。

| 状态 | 数量 |
| --- | --- |
| 自动化通过 | 114 |
| 部分实现 | 33 |
| 未实现 | 8 |
| 明确非产品范围 | 1 |
| 外部阻塞 | 1 |

---

## NAV — 信息架构与产品壳(M1,白皮书 §6)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| NAV-1 | 五个一级入口:今天/记忆/记录/家人/我的 | Web 与原生一致;无第六主导航 | 自动化通过(2026-09-06 M1 落地) | components/navigation-items.ts; mobile/src/navigation/AppNavigator.tsx |
| NAV-2 | 收件箱下沉为整理入口,保留旧路由与深链重定向 | /inbox 及原生栈路由不 404 | 自动化通过(M1:二级导航首位+记忆页内+原生栈路由) | app/(protected)/(app)/inbox; mobile stack Inbox |
| NAV-3 | 今天:真实近期记忆+继续草稿+一个回顾入口;空家庭引导第一条 | 不造假回忆 | 自动化通过(M1:待整理与草稿卡+每周回顾卡) | app/(protected)/(app)/page.tsx |
| NAV-4 | 记忆:资料库/时间轴/日历/相册/搜索/人物筛选;资料与记忆可切换视图 | 切换不是审核门 | 自动化通过(M3-C：Web/原生全量原件库，不要求事件/AI/已整理；筛选分页、打开、组合草稿与直接相册引用) | /library; mobile/src/screens/AssetLibraryScreen.tsx |
| NAV-5 | 记录:图文音混合编辑器,持久保存中断状态 | 杀进程后恢复 | 部分实现(M3-B 双端聚合持久化已接入；Web 离线关页恢复通过；私密记忆读者与真机验收待补) | mobile/src/screens/CaptureScreen.tsx; /capture |
| NAV-6 | 家人:最近补充/人物/原声/问题/邀请;非管理员无维护菜单 | 角色过滤 | 自动化通过(M1:最近补充 feed+三入口;管理按钮角色过滤) | app/(protected)/(app)/family |
| NAV-7 | 我的:同步/下载/隐私/账号/救援/作品/高级设置 | 归拢入口 | 自动化通过(M1:Web 四分组;原生 More=我的) | app/(protected)/(app)/more |
| NAV-8 | 记忆卡/资料卡/播放器/日期控件/错误与加载状态统一设计系统 | 无平行 UI 框架 | 自动化通过(设计系统+组件已统一) | design-system/ components/ |
| NAV-9 | 小屏/平板/桌面;大字/系统字体缩放/读屏/键盘/44px 触控/深浅色/reduced-motion | a11y 检查 | 部分实现(GLM-C:reduced-motion Web 全局压制并有 e2e 断言;键盘登录/主导航/上移下移(既有)可用;底部导航≥44px;共享文字样式去掉固定行高使系统大字号不裁剪并有回归测试;首页/我的/搜索/同步横幅补 accessibilityRole/Label;原生无自定义动画。真机读屏/系统大字号实测与全站 icon 审查仍待补) | components/; mobile/src/theme.ts; tests/e2e/a11y.spec.ts |
| NAV-10 | 中文默认;结构支持国际化;界面不混代码术语 | 术语审查 | 部分实现(全中文已做到;无 i18n 框架——单语可接受) | 全部 UI |
| NAV-11 | 长辈阅读/贡献模式只保留必要动作 | 不能空按钮拼凑 | 部分实现(GLM-A:双端设备级「大字简洁显示」——标准/简洁由用户主动选择并按设备持久；简洁首页只留最近的照片/最近的故事/听听家人的声音/我也说几句且空状态如实；复杂入口隐藏但路由与权限不变、可随时返回标准；贡献向导收口为问题→录音→重听→提交、成功后可再说一段；Web 播放文字按钮与真机长辈任务仍待补) | lib/display-mode.ts; app/(protected)/(app)/simple-home.tsx; mobile/src/screens/SimpleHomeScreen.tsx; app/contribute/[token]/guest-contribution-form.tsx |
| NAV-12 | 虚构/合成示例素材;真实儿童照片不进 Git | fixture 审查 | 自动化通过(tests/fixtures 全部生成) | tests/fixtures/ |

## ID — 身份、权限与生命周期(M2,白皮书 §10–13)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| ID-1 | Instance/User/AuthIdentity/FamilyMembership/Person/Guardian/GuestGrant 分离 | 数据模型核对 | 部分实现(M2-d 后:Person/Guardian/GuestGrant(投递箱+限定阅读 0050)齐备且监护授权留痕;AuthIdentity 多身份与显式 membership 状态机仍以 user 单行承载——停用/解绑/删除语义等价,见 SECURITY §18) | db/schema/(family|collection|oral-history).ts |
| ID-2 | 角色 owner/admin/editor/contributor/viewer/guest | owner 缺失 | 自动化通过(M2-a 核验：owner/admin/editor/contributor/viewer；guest 用独立 scope grant) | lib/authz/policy.ts; db/migrations/0047_owner_role.sql; tests/integration/ownership.test.ts |
| ID-3 | 首用闭环:创建家庭→HTTPS核实→一次性初始化→登录→建家庭人物 | bootstrap 零隐私 | 自动化通过 | app/api/bootstrap; tests/integration/bootstrap-flow |
| ID-4 | 邀请:高熵链接/二维码、预览不消耗、原子claim、角色服务端验证 | 过期/撤销/重放不越权 | 自动化通过 | lib/invitations; tests/integration/invitation-flow |
| ID-5 | 访客提交/限定阅读独立 scope,只存hash,限时限次可撤销 | scope 不可互换 | 自动化通过(2026-09-07 M2-d:投递箱(只提交)+限定阅读链接(只读单一相册,0050;令牌只存哈希;可过期/收回即时失效;媒体按相册范围裁决;访客强制 inline 不能批量下载)) | lib/family/read-grants.ts; app/view/[token] |
| ID-6 | 密码+Passkey;管理员 TOTP+恢复码 | 成熟实现 | 自动化通过(2026-09-07 M2-b:better-auth twoFactor(TOTP+恢复码,AEAD 加密存储)+@simplewebauthn Passkey 注册/登录;原生动态码/恢复码登录已有 SQLite/真实 HTTP 与控件自动化；认证配置和 Passkey 仍在 Web，真机待验) | lib/auth/(auth|passkey).ts; app/settings/security; tests/e2e/security.spec.ts |
| ID-7 | 无邮件时的本机受审计恢复 CLI | 不开公开重置后门 | 自动化通过(2026-09-07 M2-b:npm run recover-account 仅主机本地;令牌 256-bit 只存哈希 15 分钟;重置即撤销全部会话;无 HTTP 签发入口) | scripts/account-recovery.ts; lib/auth/account-recovery.ts |
| ID-8 | 恢复码一次显示、hash保存、原子单次使用 | 不能误删最后路径 | 自动化通过(2026-09-07 M2-b:恢复码以实例 AUTH_SECRET 派生密钥 AEAD 加密存储(非明文/非哈希——成熟组件语义,如实登记);生成即替换旧列表;每码单次使用;登录第二腿可作废) | lib/auth/two-factor-service.ts; tests/integration/two-factor.test.ts |
| ID-9 | 活动设备列表、撤销其他会话、改密后失效重入不删本机原件 | 会话管理 | 自动化通过(M2-a 设备列表/撤销其他;M2-b 恢复令牌重置密码即撤销全部会话) | settings/sessions; lib/auth/account-recovery.ts |
| ID-10 | 高敏操作(导出/重置认证/改密钥/转所有权/销毁)要求近期重新认证 | step-up auth | 自动化通过(2026-09-07 M2-c:session.recent_auth_at(0049)+10 分钟窗口;完整导出路由强制复核,设置页密码确认 UI;所有权移交/关闭两步验证/恢复码重生成各自内建密码确认;"改密钥"为部署级操作不在 App 内) | lib/auth/step-up.ts; app/api/export |
| ID-11 | 对象级受众:仅自己/指定成员/家庭;角色+对象双检查 | 默认拒绝 | 部分实现(P0-A/B/C 已完成真实双端读者、日期及私密续传；R08 已补正文、账号范围导出和恢复身份隔离；全部派生/撤权缓存仍待闭合) | lib/authz/*; tests/integration/isolation |
| ID-12 | 派生内容读者 ≤ 全部来源共同允许范围 | 撤权后派生下架 | 部分实现(R08 已补导出来源闭包、私密作品账号归属及合集事件实时裁决；旧在线作品/讲述/缓存等全部再分享入口仍须继续验证) | lib/authz/contribution-access |
| ID-13 | 成员生命周期:暂停/退出/移除/角色变更停止后续同步 | 离线副本撤权说明 | 自动化通过(2026-09-07 M2-c:停用/恢复/角色调整已有;新增移出家庭+自助退出,均解绑并即刻撤销全部会话停止后续同步;离线已缓存副本无法远程抹除已在 UI/文档如实声明) | lib/accounts/service.ts; settings/accounts; tests/integration/member-lifecycle |
| ID-14 | App 内删除账号+关联内容处理;人物记录不级联误删 | Apple 删号要求 | 自动化通过(2026-09-07 M2-c:密码+确认语双确认;凭据全撤(密码/通行密钥/两步验证/会话)+身份匿名化(邮件→deleted-*.invalid)+永久停用;讲述/胶囊/AI 任务等 RESTRICT 引用保留行以保档案完整,人物不级联删除;已下载副本不可召回如实声明) | lib/accounts/service.ts; settings/account |
| ID-15 | 跨作者内容删除影响预览/合法保留说明/删除完成状态 | 引用守卫 | 自动化通过(回收站+素材引用守卫) | lib/trash |
| ID-16 | 孩子本人账号绑定、监护权变更、范围审阅与导出 | 不按年龄自动解锁 | 自动化通过(2026-09-07 M2-d:孩子绑定邀请只允许 viewer/contributor 且必须由在册监护人发起,监护授权审计 person.child_account_invited;日后改角色同样封死 admin/editor;绑定不解锁 child_later(解锁仅监护人手工);监护权变更 M1 已有+审计;孩子以所授角色在应用内审阅,完整导出仍是管理员能力,如实登记) | lib/invitations/service.ts; tests/integration/child-account.test.ts |
| ID-17 | 所有权移交/可信接管:通知/等待/撤销/离线运维交接包 | 不自动推断死亡 | 部分实现(M2-a 所有权移交、密码确认和审计已有；通知/等待/撤销及维护交接包仍待补) | lib/accounts/service.ts; tests/integration/ownership.test.ts |
| ID-18 | 多孩子/双胞胎/多监护人/历史称呼可表达 | 非唯一"妈妈"字段 | 自动化通过 | person 模型+关系 |
| ID-19 | 祖辈记忆允许无 childPersonId;年龄展示用真实生日+家庭时区 | 不强制事件挂孩子 | 自动化通过(M3-A：0051 可空年龄锚点；无孩子建家庭、创建/编辑/搜索/导出恢复；参与人独立；真机待 BLK-7) | tests/integration/unanchored-memory.test.ts; optional-anchor-migration.test.ts; mobile/tests/optional-anchor.test.ts |

## CAP — 资料库、混合记录与媒体原件(M3,白皮书 §7,§21)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| CAP-1 | 统一持久 Draft:文字/附件引用/顺序/封面/日期精度/人物/读者/目的地 | 新建/继续/自动保存/放弃/恢复 | 部分实现(0052 Draft/DraftItem、IndexedDB/SQLite 聚合与 HTTP 幂等保存、排序封面/导出恢复已有；跨设备继续与授权媒体阅读已接入；M3-D 0056 intake 目的地可选并持久恢复；0057 私密事件读者模型落地——draft visibility family/members/private+readerUserIds、publishDraft 直接产出对应可见性事件、Web 编辑器三档读者+成员选择+私密直传(visibility=private 不入收件箱/资料库窗口)、移动 CaptureScreen 三档读者选择(切档清空读者/成员多选/成员档未选读者阻止发布,与 Web 同语义)、时间轴/详情/搜索/日历/回顾/同步/媒体/资料库全链路按对象读者实时裁决(T07/T08/T09 集成测试)；事件日期精度已六档落地；0062 已接通 Web/手机全部草稿新原件的作者私密续传与 asset 回执；实际手机 UI/SQLite/HTTP 验证两照片、9 MiB 合成 WAV、Files 批次、重开、chunk/complete 回执丢失、草稿同步和发布；0063/0064 成对原件恢复、发布/整理/归档关系已有真实回归；完整私密派生/授权恢复链仍待补) | lib/drafts; lib/authz/event-access.ts; mobile/src/drafts; tests/integration/private-memory.test.ts |
| CAP-2 | 保存即得可读记忆;日期精度 unknown/approx/date/month/year | 不用假instant | 部分实现(§6 已打通六档精度 exact/approximate/date_only/month/year/unknown——共享精度模块[显示文案/锚点换算/日历与筛选语义]，draft 模型与 publishDraft 支持无时间保存[unknown 用创建时刻做内部排序锚点,永不显示为发生时间]，月/年锚点为该期首日仅用于排序与月分组；日历天级计数/日视图排除非到日精度、月精度入 rough 待细化列表；时间轴/详情/搜索日期筛选排除 unknown；年龄显示按精度省略；Web 捕获/编辑表单提供六档选择；移动 CaptureScreen 六档精度选择器——精确/大约沿用日期→时间两步,只到日/到月/到年借日期选择器并明确"只保留到月/年"文案,锚点收细为该期首日,不详不写发生时间；移动 dateLabel 精度感知。T10 集成+单元 9 测试+移动 14 屏测。导出 timeline.md/书籍 PDF·EPUB/回顾周记素材的日期文案均按精度呈现(unknown 不进月份分组单独成节且不显示日期,月/年不带日,年龄仅到日精度给出);DST 时区月/年锚点按期首日当时偏移换算、秋季回拨墙钟如实显示、跨年排序与家庭时区归属专项单测 7/7。六档精度全链路完成) | lib/metadata/precision.ts; mobile/src/components/PrecisionDateTimeField.tsx; tests/integration/date-precision.test.ts |
| CAP-3 | 批量导入先是资料,不一文件一事件,不强制审核 | 500张≠500日记 | 自动化通过(M3-C：import session→原件库立即可看，30张不创建事件、5张组成一件事) | lib/imports; tests/e2e/asset-library.spec.ts |
| CAP-4 | 本机提交顺序:暂存→复制校验→原子落盘→DB+outbox→反馈 | 任一步退出可对账 | 自动化通过 | mobile/src/storage/files.ts; mobile/tests |
| CAP-5 | 本机照片点开大图/视频/录音播放/文字全文;AI/登录不挡查看 | 缺文件诚实报错+恢复入口 | 自动化通过 | mobile/src/screens/LocalCaptureDetailScreen |
| CAP-6 | 入口:相机/相册/麦克风/Files、SEND/SEND_MULTIPLE、iOS分享扩展、Web拖放/PWA分享 | 扩展不用服务器Key;receipt可重放 | 自动化通过(M3-D:系统分享收件可选去向——加入已有草稿只组成一件事或仅存资料库,刷新后仍可改选;原生 intake store/recovery/sync 持久化) | modules/share-intake; app/share; lib/imports/share.ts |
| CAP-7 | 格式:JPEG/PNG/HEIC、MOV/MP4、M4A/MP3/WAV、安全PDF/文本/文档 | MIME/魔数/大小/炸弹/穿越防护 | 自动化通过 | lib/assets/validation; tests/integration |
| CAP-8 | Live Photo 图+视频配对保留 | 不去重丢组件 | 自动化通过(0063 组/角色；原生 pairedVideoAsset、双端明确手动配对；复制中断及满草稿恢复、原子 SQLite 引用；私密续传/发布/整理/导出新目录恢复保留两份原件；真机另验) | tests/integration/live-photo.test.ts; mobile/tests/live-photo-recovery.test.ts; mobile/tests/capture-production.http.ts; tests/e2e/native-capture.spec.ts |
| CAP-9 | EXIF/XMP/sidecar 保留;方向/HDR/HEVC降级/无EXIF/iCloud按需 | capturedAt≠importedAt | 自动化通过 | lib/metadata; tests/integration/exif |
| CAP-10 | 文档不执行HTML/宏 | 受限预览 | 自动化通过 | lib/assets/document-text |
| CAP-11 | 资料可多处引用;移除相册项不删原件 | 引用计数 | 自动化通过(M3-C：相册直接引用原件；移除引用不删原件；离线阅读与访客链接复核权限) | lib/collections; lib/reading; lib/family/read-grants |
| CAP-12 | hash 去重与授权分离;不泄露他人文件存在性 | 跨家庭不侧信道 | 自动化通过 | tests/integration/isolation |
| CAP-13 | 旧文件夹/Takeout/sidecar 显式导入+预览+冲突处理 | 不自动镜像全云图库 | 部分实现(文件夹导入有;Takeout/sidecar 元数据未接) | lib/imports |
| CAP-14 | Immich/Nextcloud 明确导入路径或受控只读适配 | 不写他方数据库 | 明确非产品范围(1.0 提供导出/文件夹路径,适配器后续) | docs |
| CAP-15 | 原件字节不可覆盖;授权删除不受阻 | SHA 不变 vs 可删除 | 自动化通过(M3-C：原件 SHA 不变；管理员/原上传编辑者显式删除；使用中拒绝；磁盘失败持久重试；删除记录可导出恢复) | lib/assets/deletion.ts; tests/integration/asset-deletion.test.ts |

## SYNC — 授权同步、续传与冲突(M4,白皮书 §20)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SYNC-1 | 目的地绑定 instanceId+verified origin+account+family+scope | 连接≠授权 | 自动化通过 | mobile/src/state/AppContext authorizeUpload |
| SYNC-2 | 首次登录明确选择:全部/部分/仅本机 | 域名复用/换号重核验 | 自动化通过 | mobile/src/screens/SyncConsentScreen |
| SYNC-3 | 异步结果代际栅栏;旧请求不重填新账号缓存 | 401/403/404/断网区分 | 自动化通过 | isCurrent() checks; tests |
| SYNC-4 | 续传:offset/请求大小/过期/hash/幂等提交;大文件不入JS heap | tus 语义 | 自动化通过 | app/api/uploads; lib/imports/service |
| SYNC-5 | 批次暂停/恢复/重选/重试/有界并发/临时空间 | 重启后无重复事件 | 自动化通过 | tests/integration/resumable-upload |
| SYNC-6 | complete 响应丢失/确认重放只保留预期一组 | captureId 幂等 | 自动化通过 | 409 on ID reuse |
| SYNC-7 | 服务端单调变更序列+tombstone;cursor 过期安全重建 | 全轮成功前不清旧缓存 | 部分实现(全量快照同步有;增量cursor+tombstone未做) | lib/mobile/sync |
| SYNC-8 | 编辑 expectedRevision;冲突保留两份可比较 | 撤权/删除优先 | 部分实现(Web 详情/回顾保留输入、mobile PATCH 必填 expectedRevision/mutationId、所有事件编辑递增版本、0070 事务幂等收据及提交前撤权检查已有真实回归；原生编辑/分享已接通并在冲突后刷新保留输入；离线冲突比较和同步协议仍待贯通) | memory_event_revision; memory_mutation; tests/integration/memory-edit-permissions.test.ts; tests/e2e/edit.spec.ts; tests/e2e/review.spec.ts |
| SYNC-9 | 取消上传/仅本机/删记录/清缓存四操作分开 | 清缓存不伤原件 | 自动化通过 | mobile settings/device-clear tests |
| SYNC-10 | 后台执行尊重平台限制 | 不承诺杀进程后无限后台 | 自动化通过(前台/网络触发;无后台任务声明) | AppContext |
| SYNC-11 | 本机救援包:hash/关系校验、拒绝穿越/炸弹、恢复独立本机不上传 | 无凭据 | 自动化通过 | mobile/src/rescue |

## FAM — 家人共写、长辈贡献与提醒(M5,白皮书 §8)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| FAM-1 | 补一句/补素材/请家人讲一段;独立Contribution保留作者/原文/来源 | 不冒充作者 | 自动化通过 | lib/contributions |
| FAM-2 | 轻评论/回应;无热榜/签到/排行/已读压力 | 不做社交压力 | 自动化通过(无此类功能) | — |
| FAM-3 | 免账号贡献页一屏:问题/录音/重听/提交 | 大字/字幕/读屏/标点 | 自动化通过 | /contribute/[token] |
| FAM-4 | 访客默认只提交不读库;限定阅读独立授权在线可撤销 | token 分 scope | 自动化通过(M2-d 核验：投递与限定相册阅读 scope 独立，过期和撤销即时生效) | lib/family/read-grants.ts; tests/integration/read-grants.test.ts |
| FAM-5 | 投递箱多文件/限额/过期/暂停/撤销;审核通过挂到正确事件 | 不默认AI外发 | 自动化通过 | contribution_portal_submission |
| FAM-6 | 提醒:本机通知+可选SMTP摘要;概括文案无私人照片;订阅/取消/时区/静默/频率 | 无权限不影响核心 | 部分实现(本机通知有;SMTP邮件摘要未实现) | mobile/src/notifications |
| FAM-7 | 问题来自真实内容;可跳过/静音/关闭;不显示整理债务 | 无38项待办压力 | 自动化通过 | oral-history requests |
| FAM-8 | 重要原话可提升为长期讲述,不静默改作者 | 修订留痕 | 自动化通过 | transcripts revision |

## AI — 固定 Luna+MiMo 双路由(M6,白皮书 §14–16)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| AI-1 | 默认路由:文字+图片→CPA→gpt-5.6-luna;语音→MiMo mimo-v2.5-asr | 两路独立BaseURL/Key/模型 | 自动化通过(M6 dual 配置+默认模型+分能力绑定;真实链路见 BLK-1/2) | lib/ai/config.ts; lib/ai/dual-route.ts; tests/unit/ai-dual-route-*.test.ts |
| AI-2 | Luna 支持官方兼容地址+管理员可改第三方BaseURL | Responses/Chat Completions 按能力profile | 自动化通过(AI_TEXT_PROFILE/AI_VISION_PROFILE 按能力选 API 形态——responses=/responses 端点(input 消息数组+max_output_tokens+text.format JSON 模式,input_image 视觉分段),chat_completions=传统端点;拒绝分段/incomplete 状态如实映射,不伪装内容;配置进 configurationId 指纹,ops configure 提示项+diagnostics status 展示;换 BaseURL 主机时需终端输入 confirm 显式确认 Key 发往新地址,未确认不做任何更改。单元 28/28+Python 5 项) | lib/ai/openai-compatible.ts; lib/ai/config.ts; scripts/ops/lib/ai.py |
| AI-3 | CPA 只支持文字时如实降级,不假装视觉可用 | 用非私人测试图实测理解 | 部分实现(能力测试有 text/vision/transcription;需按新双路由重构) | scripts/ai-diagnostics.mts |
| AI-4 | MiMo 按小米官方ASR契约实现,不默认OpenAI transcriptions端点 | 音频编码/时长/分段/时间戳核验 | 自动化通过(M6:chat/completions+input_audio+api-key;mp3/wav直传其余转WAV;无时戳不虚构;真实契约 BLK-2) | lib/ai/mimo-asr.ts; tests/unit/ai-mimo-asr.test.ts |
| AI-5 | 普通成员只见"文字与图片整理/语音转写";高级配置显地址与模型 | 分能力授权 | 自动化通过 | settings/ai; mobile ai/settings |
| AI-6 | ftc ai configure/status/test/disable;服务端安全存Key;重建不丢配置;status不偷发付费请求 | 已有,需扩双路由 | 自动化通过 | scripts/ops/lib/ai.py |
| AI-7 | 规则命名不接模型也有友好名;保留originalFilename | 三名称分离 | 自动化通过 | lib/naming; lib/names |
| AI-8 | 图像流水线:去EXIF受限预览→描述/OCR→标题/标签 | 大小/超时防护 | 自动化通过 | analyze-asset-image handler |
| AI-9 | 语音三层:原音→机器转录→人工修订→Luna少改整理;分层分开 | 无时戳不虚构定位 | 自动化通过(转录+修订有;Luna整理层待新路由) | lib/transcripts |
| AI-10 | 视频:抽帧给Luna+音轨给MiMo;综合标题摘要 | 资源受限 | 自动化通过 | analyze-asset-video |
| AI-11 | 多素材:用户明确选中→复用分析→可审事件建议;确认才合并 | 不自动合并 | 自动化通过 | suggest handlers; inbox merge |
| AI-12 | 回顾/章节草稿依据所选来源+sourceRef;不自动发布 | 保留原话 | 自动化通过 | generate-story; optimize.review_story |
| AI-13 | 任务图:持久依赖/租约/检查点/限额/取消/失败分类 | DAG | 自动化通过 | ai_job_dependency; jobs/runtime |
| AI-14 | 去重键含family/来源hash/步骤/模型/promptVersion/权限 | 成功复用;人工改后重检 | 自动化通过 | organizer |
| AI-15 | 标题来源 manual/accepted_ai/ai_suggested/rule_generated/legacy_unknown | 历史IMG名不自动抹 | 自动化通过 | title_source/title_revision |
| AI-16 | AI晚到不覆盖人工标题;采用才提交修订 | 修改后采用/忽略/撤销/重生成/批量 | 自动化通过 | tests/integration/suggestions |
| AI-17 | 不编造"第一次/出院/亲属身份/健康判断";无真实时间不补造日期 | sourceRef+引文 | 自动化通过 | facts/source-refs |
| AI-18 | 私密上下文不传播到家庭公共标题;索引/缓存随权限变化 | 派生权限 | 自动化通过 | visibility post-filter |
| AI-19 | AI默认关闭;分能力内容告知(→谁/用途/保留未知/关闭方式) | 上传VPS与送CPA/MiMo分环节告知 | 自动化通过(M6:能力卡与移动端显示分能力接收服务) | settings/ai; mobile/src/ai |
| AI-20 | 自动新素材/历史回填/访客资料分开授权 | 不当同意全量 | 自动化通过 | ai_processing_consent |
| AI-21 | 低并发;原子每日限额(请求/图片数/音频时长);重试/Retry-After/取消/紧急关闭 | usage未知显示未知 | 自动化通过(P0-D：worker/显式搜索/诊断统一发送授权与配额；关限额仍计数；实际时长向上取整；进程竞争/重启/日界/撤权退款负例；真实模型账单未验收) | lib/ai/dispatch.ts; lib/ai/quota.ts; tests/integration/ai-dispatch.test.ts; tests/integration/ai-search-dispatch.test.ts |
| AI-22 | 文件名/OCR/转录是数据不是指令;不取URL/执行命令/读无关上下文 | 提示注入防护 | 部分实现(M3-C：原件起名明确不可信数据边界、严格 title schema/拒绝 URL/晚到结果守卫及专项测试；其余 AI 链路仍须统一扫查) | lib/ai/handlers/suggest-asset-name.ts; tests/integration/asset-name.test.ts |
| AI-23 | Luna文字/Luna图片/MiMo语音三个独立live测试;fake/集成/live分层 | 无凭据不勾选真实链路 | 部分实现(M6:testAiCapability 经工厂自动走 MiMo;真实凭据 BLK-1/2) | scripts/ai-diagnostics.mts; ftc ai test |
| AI-24 | 不把开发Agent登录态当产品凭据;不放进App | 审查 | 自动化通过(NEXT_PUBLIC key 显式拒绝) | lib/ai/config |

## FIND — 找回、辅助选材与回顾(M7,白皮书 §9)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| FIND-1 | 统一索引:记忆/素材描述/OCR/转录/讲述/故事/相册/作品文本;可重建 | 权限复核 | 自动化通过 | lib/search; search:rebuild |
| FIND-2 | 关键词/人物/日期/媒体/标签筛选无AI可用;离线对合法缓存可用 | 不下发无授权索引 | 部分实现(正式1.0 §4 重写：离线搜索改为投影式匹配——只搜标题/正文/讲述/转录/人物显示名/素材显示名/地点,内部 JSON/路径/token 绝不参与匹配或摘要,损坏 JSON 单行跳过;timeline/people 缓存补逐行 scope,读路径按 scope 过滤不依赖换号清空;SearchScreen 请求代际管理——乱序丢弃/卸载保护/写回前复核连接与授权范围/筛选变化不分页混页;错误按 ApiError.status 分类,401/403/400/429/5xx 不再伪装断网,429/5xx 提供显式「只搜本机」入口;服务端移动搜索 API 与离线共享 personId/date/mediaType 筛选语义,游标绑定筛选;已归档本机记录与服务器记忆去重、稳定排序、hasDetail=当前 scope 内有可读详情。真机飞行模式验收待补;标签筛选离线缓存未携带,如实不显示) | mobile/src/search/offline-search.ts; mobile/src/screens/SearchScreen.tsx; app/api/mobile/v1/search/route.ts |
| FIND-3 | 自然语言查询:Luna生成受限校验的检索条件→FTS返回来源卡 | 不执行模型SQL;不凭记忆答 | 自动化通过(P0-D：显式幂等 POST、刷新/预取零调用、严格计划、人物未解析拒绝、人工筛选优先、闰年二月末生产浏览器回归；真实 Luna 质量未验收) | lib/search/natural-language.ts; tests/unit/search-natural-language.test.ts |
| FIND-4 | NL 检索对关键词基线报告 Recall@K/误召回 | 不冒称CLIP | 部分实现(M7-a 合成关键词基线/理想计划上限脚本已存在；尚非真实模型对比评测，fake 只验证失败关闭) | scripts/benchmark-search-nl.mts; BLK-1/8 仅影响真实评测 |
| FIND-5 | 近似照片:感知hash/时间/批次候选组+清晰度建议;不识别人脸;不自动删 | Live Photo不误合并 | 自动化通过(GLM-D:dHash 候选组理由可解释——哈希距离/拍摄时间差/尺寸方向/同一导入批次;字节完全相同(SHA-256 一致)与画面相似严格分开表述,UI 不叫“重复照片”;清晰度仅为“细节最多”提示;Live Photo 组件说明且不当作相似重复;操作为勾选合并/全部保留/内嵌加入相册(已有或新建,引用原件不移出收件箱,建议保持待处理),无任何删除;按勾选成员合并已支持。感知哈希持久缓存 0059 cluster_feature_cache——按来源 SHA+算法版本键,命中免读原件,损坏位串按未命中重算,旧算法/孤儿行随写清理,缓存读写失败不影响扫描正确性;集成 7/7 覆盖缓存权威性/失效/加相册。真机大数据量待验) | lib/clusters/service.ts; db/migrations/0059_cluster_feature_cache.sql; app/(protected)/(app)/inbox/cluster-suggestion-ui.tsx |
| FIND-6 | 相关记忆按时间/人物/标签/相册解释理由;不足少显示 | 不伪装算法相关 | 自动化通过(resurfacing 按真实日期) | lib/memories/resurfacing |
| FIND-7 | 年/月/日/年龄浏览;全屏;倍速;真实转录定位;返回保留筛选位置 | 不全量预载 | 自动化通过 | calendar; transcripts |
| FIND-8 | 周/月/年精选、来源周记、原片短回顾;预览后发布;无AI模板成稿 | 许可清楚 | 自动化通过 | lib/review; books/review |
| FIND-9 | 隐藏人物/敏感日期推荐;近期不再推荐;暂停提醒;已故人物状态;不造假去年今天;不生成逝者回答/祝寿 | 默认无错误庆祝 | 部分实现(§8 0058：resurfacing_preference 按用户记录屏蔽——暂不推荐某件事/屏蔽人物/屏蔽日期范围/暂停回顾,只影响该用户的自动推荐（今天页/回顾卡）,不删除来源、不影响主动搜索与打开、其他家人不受影响;hasHistory 不因暂停误报空家庭;Web 回顾页提供偏好面板与逐卡屏蔽,可随时取消;移动本地提醒已有开关。T13 集成 4 测试。剩余：已故人物登记状态参与规则[本人明确登记,不推断]、邮件摘要[未实现]、真机验收) | lib/memories/resurfacing-preferences.ts; tests/integration/resurfacing-blocks.test.ts |

## WORK — 相册、作品与时间胶囊(M8,白皮书 §9)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| WORK-1 | 相册/章节:选材/封面/说明/排序/多选/移除/删除恢复;触控+键盘上移下移 | 不只拖拽 | 部分实现(排序有;键盘上移下移未核) | collections screens |
| WORK-2 | 作品三模板:照片册/图文成长册/家人来信;封面/标题/目录/章节/单双图/引文/日期/来源 | 自动保存/重开/冲突/版本 | 自动化通过 | book projects |
| WORK-3 | Web完整编排;原生书架/选材/基础调整/阅读/导出状态 | 高级排版留Web明确标注 | 自动化通过 | BookScreens |
| WORK-4 | 月/年/出生第一周/第一个月/百天范围草稿;幂等;新资料提示不改写人工内容 | — | 自动化通过 | books/review |
| WORK-5 | PDF中文可搜索选择;EPUB过EPUBCheck;ZIP精选包file://离线可读;原声随范围打包 | 二维码非唯一入口 | 自动化通过(CI 装 epubcheck) | lib/books/render |
| WORK-6 | 渲染受限/取消/重试/原子;不与AI绑定;内存有界;按revision与读者绑定;下载重验 | — | 自动化通过 | render jobs |
| WORK-7 | 私人版与家庭版;撤权后禁止新在线下载;已拿走文件说明不可收回 | — | 自动化通过 | reading packages |
| WORK-8 | 时间胶囊:创建/选材/信/问题/封存/日期或年龄开启/回信;服务端时钟校验 | 封存=访问规则非加密;导出按目的处理 | 自动化通过 | lib/capsules |
| WORK-9 | 原生主动下载相册/作品:容量/暂停续/配额/清理;缓存与原件/outbox分离 | 清理不伤自有 | 自动化通过 | src/reading |

## OPS — 一键部署与安全发行(M9,白皮书 §22)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| OPS-1 | ftc install/adopt/status/version/doctor/logs/setup-info/start/stop | adopt 未实现 | 部分实现 | scripts/ops |
| OPS-2 | upgrade --check/upgrade/rollback;A/B/C/D失败分级 | 已有;故障注入测试 | 自动化通过 | upgrade.sh; ops tests |
| OPS-3 | backup/backup verify/restore/cleanup --dry-run | — | 自动化通过 | backup.sh 等 |
| OPS-4 | ftc ai configure/status/test/disable | 双路由扩展中 | 自动化通过 | ai.py |
| OPS-5 | 仅主机本地的账号恢复与配置迁移CLI | 账号恢复已落地;配置迁移待 M10 交接包 | 部分实现(2026-09-07 M2-b:npm run recover-account;配置迁移随 BKP-10) | scripts/account-recovery.ts |
| OPS-6 | Debian/Ubuntu+CPU架构实测声明;不把amd64写成arm64 | 现仅linux/amd64 | 自动化通过(诚实声明) | install.sh 平台提示 |
| OPS-7 | 已装Docker复用;缺依赖授权安装;不动防火墙 | — | 自动化通过 | install.sh |
| OPS-8 | 新机Caddy HTTPS;已有OpenResty/Nginx环回+审查代理片段;不抢80/443 | — | 自动化通过 | templates |
| OPS-9 | 探测旧实例确认接管;不换空卷冒充升级 | adopt 命令缺 | 部分实现(卷冲突拒绝有) | install.sh |
| OPS-10 | 固定发行/镜像digest与版本匹配/校验和/不执行任意拼接URL | 注册表已建(M0-V) | 自动化通过 | releases.json |
| OPS-11 | 输出HTTPS地址/实际运行版本/安全初始化指引;外网不通只报部分成功 | — | 自动化通过 | install.sh |
| OPS-12 | main push不触发生产自动更新;stable只选验证stable | 通道纪律 | 自动化通过 | VERSIONING/UPGRADE.md + 注册表 |
| OPS-13 | 兼容矩阵:Web/API/镜像/worker/脚本/移动协议 | 文档化 | 部分实现(release-manifest 有雏形) | mobile-build.yml |
| OPS-14 | 运行时版本从构建信息/manifest;诊断脱敏不回显配置全文 | — | 自动化通过 | healthcheck; logs.sh redaction |

## BKP — 备份、升级、恢复与交接(M10,白皮书 §23)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| BKP-1 | 四种副本分明:完整家庭档案/实例快照/精选阅读包/本机救援包 | 范围声明诚实 | 自动化通过 | export vs backup vs reading vs rescue |
| BKP-2 | 应用内"完整"与实际授权范围匹配;子集标明 | — | 自动化通过 | lib/export |
| BKP-3 | 本机一致快照+独立故障域远端副本+定时验证 | WebDAV verified upload | 自动化通过 | lib/webdav; backup_run |
| BKP-4 | restic 可选加密异地保全 | 未实现(可选增强) | 未实现 | — |
| BKP-5 | 保留策略只清过期非唯一副本;容量不足告警不停备份 | — | 自动化通过 | cleanup.sh |
| BKP-6 | 检查分级:生成/上传/结构校验/原件校验/隔离恢复通过 | — | 自动化通过 | roundtrip tests |
| BKP-7 | 升级真实维护状态机覆盖app写API/上传finalize/worker | 不靠sleep证明 | 自动化通过(维护503+停容器) | maintenance profile |
| BKP-8 | 旧备份恢复重新应用已知撤权/删除记录 | tombstone 重放 | 部分实现(M3-C 原件删除记录可导出恢复；旧快照后的撤权/删除 reconciliation 仍待 M9) | lib/restore; lib/assets/deletion.ts |
| BKP-9 | restore默认新目录/卷;结构/哈希/关系切换前完成;失败无半恢复 | — | 自动化通过 | restore.sh; scripts/restore.ts |
| BKP-10 | 离线交接包:版本/数据位置/校验/域名迁移/管理员恢复/密钥指引 | 密钥与阅读包分开 | 未实现 | — |
| BKP-11 | 禁止 docker system prune/volume prune/down -v/含糊 rm -rf | — | 自动化通过(never present) | scripts/ops |

## SEC — 安全、隐私与合规(M11,白皮书 §17,§24)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SEC-1 | 威胁模型文档覆盖七类角色 | 更新至1.0 | 部分实现(docs/SECURITY.md 有 #017/RH-010) | docs/SECURITY.md |
| SEC-2 | 默认拒绝/逐对象鉴权/CSRF/scope限流/最小日志/秘密轮换/任务限额/隔离解码/依赖审计/出站检查 | — | 自动化通过(主体);依赖审计待办 | lib/security; CI |
| SEC-3 | 不把自托管写成E2EE;美国VPS/CPA/MiMo不同接收边界;未知保留标注未知 | 文案审查 | 部分实现(单通道告知有;双路由文案更新中) | docs/AI_PRIVACY.md |
| SEC-4 | 不新增人脸/声纹识别/健康诊断/成长预测/声音克隆 | — | 自动化通过(无此类代码) | — |
| SEC-5 | 儿童监护授权有记录;称呼不自动证明监护权 | =ID-16 | 自动化通过(M2-d 核验：绑定邀请仅由已登记监护人发起，留审计记录) | lib/invitations/service.ts; tests/integration/child-account.test.ts |
| SEC-6 | 私人自用：提供导出/删号/第三方清单/维护联系说明 | 用户 2026-09-08 明确不设法律审核门禁 | 部分实现（工程功能仍须逐项验收） | docs/release-1.0/BLOCKERS.md; docs/AI_PRIVACY.md |
| SEC-7 | 许可台账:代码/模型/字体/图标/音乐/素材独立 | — | 未实现(部分字体已带OFL) | resources/fonts |
| SEC-8 | Android长期签名;iOS正式渠道/证书/AppGroup/分享扩展 | keystore未固定;iOS unsigned | 外部阻塞 | mobile-build.yml |
| SEC-9 | 真实机密/儿童素材不进CI/效果图/日志/示例 | — | 自动化通过 | fixtures 全合成 |
| SEC-10 | 对外问题报告默认脱敏且用户选择发送 | — | 自动化通过(无遥测) | — |

## BIZ — 长期经营(M12,白皮书 §25–27)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| BIZ-1 | 手册:入门/长辈/环境/AI隐私/恢复删号/交接/停服阅读/FAQ/报告路径 | 中文 | 未实现(散文档有,未成手册) | docs/ |
| BIZ-2 | 演示数据与真实家庭隔离;可清理;不导生产库;无通用管理员口令 | — | 部分实现(2026-09-08:一键 `npm run demo` 合成演示家庭进独立 demo-data/，--reset 可清理，凭据仅在该目录有效且全部素材程序合成；演示部署方案与长期演示站未做) | scripts/demo.mjs; scripts/demo-seed.mts |
| BIZ-3 | 不新增支付/订阅;导出与删除不收费锁 | — | 自动化通过(无支付代码) | — |
| BIZ-4 | 存储/带宽/模型成本说明;估算≠账单 | — | 未实现 | — |
| BIZ-5 | 本地去内容化指标:首条/回看/邀请/AI耗时/导出恢复/升级干预 | 默认不遥测 | 未实现 | — |
| BIZ-6 | ~20家庭任务研究+50–100家庭12周观察方案+问卷/任务/cohort工具 | 不自动招募 | 未实现 | — |
| BIZ-7 | 不伪造留存/爆款结论 | — | 自动化通过(无此类声明) | — |

## REL — 验收与发布(M13/M14)

| ID | 需求 | 验收要点 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| REL-1 | 32 个真实演示场景(见 ACCEPTANCE.md) | 可追溯证据 | 部分实现(自动化覆盖约2/3;真实场景3项) | tests/e2e 等 |
| REL-2 | 性能目标:提交反馈p95<1s;万记忆/十万素材;大文件内存有界 | 实测非mock | 部分实现(benchmark脚本有;报告未出) | scripts/benchmark* |
| REL-3 | 泄露/静默覆盖/唯一原件丢失零容忍测试集 | — | 自动化通过 | isolation/merge tests |
| REL-4 | ~200样本命名/修订/转写/检索评测 | 模型置信度不作真值 | 未实现 | — |
| REL-5 | 仓库全门禁:lint/typecheck/test/build/E2E/roundtrip/mobile/ops/依赖/secret/Docker/升级恢复/出版/权限/AI | 不删门禁换绿 | 自动化通过(06b78da 双工作流全绿；每个后续里程碑按新 SHA 重验) | .github/workflows/ci.yml |
| REL-6 | release readiness 清单;非prerelease v1.0.0;不可移动tag;digest镜像;SHA256SUMS;manifest | 仅门禁后 | 部分实现(机制已建;门禁未全过) | mobile-build.yml; releases.json |
| REL-7 | 候选构建按唯一SHA核对CI与产物 | — | 自动化通过(tag 构建链) | mobile-build.yml |
| REL-8 | 外部阻塞如实记录,不伪造stable | — | 自动化通过(BLOCKERS.md) | docs/release-1.0/BLOCKERS.md |

---

## 明确非产品范围(白皮书/Goal 明示排除,不是砍需求)

1. 官方多租户托管/SaaS 2. 支付平台 3. 第三个默认模型/embedding 服务 4. 全图库人脸/声纹识别 5. 声音克隆 6. 医疗/育儿判断 7. 公共社交/广告跟踪 8. 独立端到端加密产品模式(自托管+TLS+受控存储为首发承诺)

## Astra / Codex 行为复核（2026-09-08）

CAP-2 / R03：手机记录页「不详」经实际 usePersistentDraft 保存的旧 guard 已用失败测试复现并修复；Web/手机/服务端共用日期完整性校验。mobile/tests/capture-persistence.test.ts 6 项覆盖 unknown 保存重开、其余五档缺日期拒绝；tests/integration/persistent-draft.test.ts 覆盖真实 Bearer HTTP、独立 SQLite 连接、导出到新目录恢复，仍为 unknown 且正文完整。无迁移或版本变更。这是日期保存缺口的自动化证据；CAP-2 整行仍部分实现，完整离线混合记忆即读和真机仍需继续验证。

P0-A / R01–R02：0061 追加迁移修复旧 draft CHECK 不接受 members；不改旧迁移，保留正文、draft_item 与 import_session 引用。新 draft-readers API 仅返回有效同家庭账号 id/name，普通作者不获得账号管理权限；人物仍用 Person ID。原生和 Web 保留/显示已失效选择供主动移除，手机可重试成员获取。新增 native-capture production E2E 使用真实手机记录页/hook/SQLite，经实际 fetch 与原生 sync 调用 Next 生产 HTTP，B 可读而 C 管理员 404；不是手工重新构造 DTO。停用/退出/异家庭/无账号人物由真实鉴权 API 回归拒绝。私密新附件和衍生传播仍按 P0-C 继续，不据此提升 CAP-1/ID-11 全行。

P0-C / R04–R07：0062 仅追加 upload_session.draft_id/instance_id 与索引；作者在每次操作校验，新素材发布前私密，不经家庭收件箱；既有已公开回执保留旧共享语义，未完成旧传输可收紧到作者草稿。两端先存草稿再传原件，手机直接持久化 assetId 并保留 Files/系统分享的原批次。显式交给家人整理才开放原件预览。跨进程 flock 文件描述符锁保护临时文件/complete；SIGKILL 自动释放，不删锁绕过，随机不存在 ID 不创建锁。新临时清理不受已删除草稿/停用作者阻塞。生产 Linux 容器显式包含 util-linux。上述自动化证据不代表 Live Photo 真机、完整撤权缓存或导出恢复已经完成；CAP-1/ID-11/ID-12 仍部分实现。


R08（当前实现）：0066/0067/0068 追加正文、隔离恢复身份和个人书籍账号归属；v2 可读档案包含明确权限清单、独立存储正文和回执，默认恢复不把私人内容归给维护者。实际 Web 发布后删草稿、索引重建、HTTP 详情与导出、独立库恢复及主机 CLI 显式绑定均已验证；真实 Docker 三次重启和容器内恢复通过。证据：tests/integration/private-memory-body.test.ts、private-archive.test.ts、memory-body-migration.test.ts，tests/e2e/native-capture.spec.ts，scripts/verify-private-upload-container.py。R09/R10 全派生及 R17/R21 恢复世代/较新撤权日志尚未闭合，相关需求仍部分实现。

R09 资料库/命名（当前实现）：资料库隐藏不可读事件关联及引用状态；添加原件检查目标事件编辑权，元数据/命名/删除不把指定读者变成作者。已公开原件加入私密事件不收回既有共享。失败回归、真实 API/SQLite 及生产浏览器证据见 private-library.test.ts 和 asset-library.spec.ts；讲述、访客相册、在线故事和阅读包最终响应边界仍待继续，ID-11/ID-12 状态不提升。


R09 家人讲述（当前实现）：读取/编辑/新增要求父事件当前可读；私密原件与衍生物的讲述引用也复验父事件，单个 HTTP/Range 与批量查询一致，独立全家共享原件保留读取但排除私密上下文自动 AI。真实失败回归见 private-contribution-event.test.ts，生产 native-capture 4/4 通过。该生产测试的分享状态通过隔离库设置，已有事件的双端分享/撤销入口和受控缓存仍待完成，不提升 ID-11/ID-12 状态。

R09 访客相册（当前实现）：访客标题/媒体同时要求来源当前可全家分享；private-root 经明确家庭事件发布仍可播放，事件撤权、签发账号停用及链接撤销对缓存解析对象也生效。private-read-grant.test.ts 和 production collections 4/4 提供真实存储/HTTP/浏览器证据。已有事件双端分享入口和受控缓存尚未闭合，ID-11/ID-12 仍部分实现。

R10 故事（当前实现）：故事组装、读取/搜索/回收站、AI 最终提交与完整输入依赖已接通；0069 将依赖持久在故事级，删除段落不擦除标题依赖。v3 归档保留和校验依赖，旧稿来源未证实则保留原文并暂停在线使用。private-story、story-input-migration、review、export/restore 有真实 SQLite、HTTP、ZIP、子进程和新目录恢复证据；根全量 837 项、production E2E 70 项、disaster roundtrip 7 项和真 Docker/v3 恢复通过，同 SHA CI `34202975077` 四项成功。回收站事件/讲述授权、已有事件双端分享撤销和受控缓存仍未闭合，ID-11/ID-12 不提升。


R09 阅读包最终响应（当前实现）：媒体读取后、产物 stat 后及服务返回后均再次检查当前作品/来源范围，拒绝时关闭未交付流。真实第二 SQLite 连接/Range/worker ZIP 的失败回归已修复；根全量 840 项、最终出版回归 12 项与 production book-projects/collections 7 项通过。已有事件双端分享、事件/讲述回收站权限和受控缓存尚未闭合，ID-11/ID-12 状态不提升。


R09 事实/回收站（当前实现）：实际父事件管理权、讲述本人身份、实时账号、软删状态与跨作者级联删除保护已接通；权限过滤在分页前。private-memory-management.test.ts 的真实 Server Actions/SQLite 先失败后通过，根全量 848 项，production edit 3 项验证私密 unknown 正文/事实恢复、另一管理员不可见和清除。详情来源读取、已有事件双端分享撤销及受控缓存仍待实现，ID-11/ID-12 保持部分实现。


R09 详情/事实来源（当前实现）：可读详情在事务内聚合，Web 归档及手机 HTTP 最终交付重新核验，相关卡片独立核对；事实正文、来源引文、确认和搜索检查全部来源，作者自己的私密记录仍可用。private-memory-detail.test.ts 覆盖真实 SQLite、原声 HTTP、服务返回竞态和事实引用；production edit 4 项、根全量 853 项、完整 production E2E 73 项与 disaster roundtrip 7 项通过。已有事件双端分享撤销、提交并发控制和受控缓存未闭合，ID-11/ID-12 保持部分实现。


SYNC-8 / CAP-2 编辑复验：旧实现可在停用后写入、把指定读者当编辑者、用他人的私人原件作新封面、无版本覆盖和拒绝 unknown PATCH，五个真实 SQLite/HTTP 失败用例均已修复。追加 0070 仅保存实例内请求摘要/结果版本；成功重复请求不重复编辑，不同内容复用键和删除后的重放拒绝。Web 详情及回顾使用受控输入，网络/冲突保留输入；各档日期使用对应控件及共用解析，细化精度须提供时间，unknown 不显示年龄。production edit/review 7/7 通过，含两个页面的真实冲突。原生已有事件编辑/分享控件与离线冲突协议仍是内部工作，SYNC-8 原“自动化通过”改为部分实现，统计按实际行重算。


R09 双端分享/原生编辑：已有记忆 Web/原生读者控制、共享版本与幂等收据、来源再分享校验、私密根原件随事件授权已接通。MemoryEditor 处理正文/六档时间/参与人修改，冲突保留输入并刷新最新详情；拒绝后清除同 scope 的详情/时间轴及摘要缓存，本机原件按草稿归属隔离。新增 memory-sharing.test.ts、memory-editor.test.ts、memory-cache.test.ts 和双端真实生产流程提供证据。最终完整门禁结果见 EXECUTION_STATE；增量同步、权限版本与历史恢复世代仍缺，不提升 ID-11/ID-12/SYNC-8 状态。


CAP-1 / CAP-2 上传简化（2026-09-09）：Web/原生选素材后可直接保存，标题/日期/人物等为折叠可选项；可信同日素材自动带入日期，无依据保存 unknown。已授权模型通过「保存并整理」在同一次操作排队，异步建议需确认，AI 失败不回滚原件；私密内容不隐式触发、原件私密根不扩权。新增 quick-capture SQLite/HTTP、原生持久化和生产浏览器合成模型链路已有证据；完整 1.0、真机及真实模型状态不因此提升。详细边界见 EXECUTION_STATE 的同名条目。
