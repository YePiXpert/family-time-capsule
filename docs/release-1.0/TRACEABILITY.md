# 需求追踪矩阵(TRACEABILITY)

> 每个 requirement ID → 代码位置 → 自动化测试 → 真实证据。状态定义见 REQUIREMENTS.md。
> 「真实证据」列在 ACCEPTANCE.md 汇总;本表只登记可点击的代码/测试路径。
> 维护规则:新增/修改需求实现时必须同步本表;CI 不检查本表,发布审查时人工核对。

## NAV — 产品壳

| ID | 代码 | 测试 |
| --- | --- | --- |
| NAV-1/2/7 | components/navigation-items.ts、app/(protected)/(app)/layout.tsx、mobile/src/navigation/AppNavigator.tsx | tests/integration/product-shell.test.ts、mobile/tests/navigation-runtime.test.ts(重构后更新) |
| NAV-3 | app/(protected)/(app)/page.tsx、lib/home | tests/integration/home.test.ts |
| NAV-4 | app/(protected)/(app)/library、lib/assets/library.ts、mobile/src/screens/AssetLibraryScreen.tsx；timeline/calendar | tests/integration/asset-library.test.ts、asset-library-migration.test.ts；tests/e2e/asset-library.spec.ts；mobile/tests/asset-library-screen.test.ts |
| NAV-5 | app/(protected)/(app)/capture、mobile/src/screens/CaptureScreen.tsx | mobile/tests/local-*、persistent-draft.test.ts、draft-sync.test.ts；tests/e2e/inbox-draft.spec.ts、persistent-draft.spec.ts |
| NAV-6 | app/(protected)/(app)/family/[id]、lib/family | tests/integration/onboarding-guardian.test.ts |
| NAV-8 | design-system/、components/ui | lint/typecheck |
| NAV-9 | components/ | 待补 a11y 检查(REL 条目) |
| NAV-11 | lib/display-mode(.server).ts、app/(protected)/(app)/(simple-home/page/layout/more/settings)、components/(display-mode-toggle/app-shell/bottom-navigation/sidebar-navigation)、app/contribute/[token]/guest-contribution-form.tsx、mobile/src/(screens/SimpleHomeScreen.tsx、components/DisplayModeCard.tsx、state/AppContext display_mode) | tests/e2e/simple-mode.spec.ts、contribute-wizard.spec.ts、tests/integration/contribution.test.ts(声音聚合)、mobile/tests/display-mode.test.ts |

## ID — 身份与权限

| ID | 代码 | 测试 |
| --- | --- | --- |
| ID-1/2 | db/schema/family.ts、lib/authz/policy.ts | tests/unit/authz-policy.test.ts |
| ID-3 | app/api/bootstrap、lib/auth/setup.ts、lib/instance/service | tests/integration/bootstrap-flow.test.ts、signup-gate.test.ts、setup-rate-limit.test.ts |
| ID-4 | lib/invitations/service.ts、app/(protected)/(app)/settings/invitations | tests/integration/invitation-flow.test.ts、invitations.test.ts |
| ID-5 | lib/contribution-portals、lib/family/read-grants.ts、app/view/[token]、app/api/media（grant 分支） | tests/integration/contribution-portals.test.ts、read-grants.test.ts、tests/e2e/collections.spec.ts（访客链接） |
| ID-6/8 | lib/auth/(auth|passkey|two-factor-service).ts、db/schema/auth.ts(0048)、app/(protected)/(app)/settings/security、app/login/two-factor | tests/integration/two-factor.test.ts、strong-auth.test.ts、tests/e2e/security.spec.ts |
| ID-7 | scripts/account-recovery.ts、lib/auth/account-recovery.ts、app/recover/[token] | tests/integration/strong-auth.test.ts(恢复)、tests/e2e/security.spec.ts(页面闭环) |
| ID-9 | app/(protected)/(app)/settings/sessions、lib/auth/account-recovery.ts | tests/integration/ownership.test.ts、strong-auth.test.ts |
| ID-10 | lib/auth/step-up.ts、db/migrations/0049、app/api/export/route.ts、settings/account/danger-zone.tsx | tests/integration/member-lifecycle.test.ts（step-up 组）、export/journey e2e 经 grantExportStepUp |
| ID-11/12 | lib/authz/(context/principal/contribution-access).ts | tests/integration/isolation.test.ts、media-access.test.ts、contribution-visibility.test.ts |
| ID-13/14 | lib/accounts/service.ts（removeFamilyMember/leaveFamily/deleteOwnAccount）、settings/account/、settings/accounts/account-card | tests/integration/member-lifecycle.test.ts、accounts.test.ts |
| ID-15 | lib/trash | tests/integration/trash.test.ts |
| ID-16 | lib/invitations/service.ts（监护人核验与孩子绑定） | tests/integration/child-account.test.ts |
| ID-17 | lib/accounts/service.ts（所有权移交；等待通知/交接包未齐） | tests/integration/ownership.test.ts |
| ID-19 | db/migrations/0051_optional_memory_anchor.sql、db/migration-safety.ts、lib/memories、lib/authz/contribution-access.ts、lib/restore、mobile/src/storage | tests/integration/optional-anchor-migration.test.ts、unanchored-memory.test.ts、tests/e2e/inbox-draft.spec.ts、mobile/tests/optional-anchor.test.ts |
| ID-18 | db/schema/family.ts(person/guardian 关系) | tests/integration/onboarding-guardian.test.ts |

## CAP — 资料与媒体

| ID | 代码 | 测试 |
| --- | --- | --- |
| CAP-1 | db/schema/draft.ts、lib/drafts、mobile/src/drafts；收件箱提交适配 | tests/integration/persistent-draft.test.ts、tests/e2e/persistent-draft.spec.ts、mobile/tests/persistent-draft.test.ts、draft-sync.test.ts；intake 目的地已接入（0056：tests/integration/intake-destination.test.ts、mobile/tests/intake-draft.test.ts）；私密事件读者仍部分实现 |
| CAP-2 | lib/metadata/time.ts、db/schema/asset.ts、lib/drafts/model.ts | tests/unit/time.test.ts；事件 unknown/month/year 未闭环，不再记为自动化通过 |
| CAP-3 | lib/imports/service.ts | tests/integration/imports.test.ts |
| CAP-4 | mobile/src/storage/files.ts(preserve*) | mobile/tests/native-share-intake.test.ts |
| CAP-5 | mobile/src/screens/LocalCaptureDetailScreen.tsx | mobile/tests/local-detail.test.ts |
| CAP-6 | modules/share-intake、app/share/route.ts、lib/imports/share.ts、app/api/imports/[id]/destination/route.ts、mobile/src/native/intake.ts | mobile/tests/share-intake-events.test.ts、intake-screen.test.ts、intake-sync.test.ts；tests/e2e/imports.spec.ts（系统分享组草稿/资料库去向） |
| CAP-7 | lib/assets/validation.ts、lib/imports/http.ts | tests/unit/media-validation.test.ts、tests/integration/ingest.test.ts |
| CAP-8 | lib/assets/ingest.ts(live photo 配对) | tests/integration/live-photo.test.ts |
| CAP-9 | lib/metadata/(ffprobe/time).ts、exif | tests/integration/exif.test.ts、real-media.test.ts |
| CAP-10 | lib/assets/document-text.ts | tests/unit/document-text.test.ts |
| CAP-11 | db/schema/collection.ts(collection_item 引用) | tests/integration/collections.test.ts |
| CAP-12 | lib/assets/service.ts(hash 复用) | tests/integration/isolation.test.ts |
| CAP-13 | lib/imports | 部分未实现 |
| CAP-15 | lib/assets/storage.ts、lib/assets/deletion.ts、0055_asset_deletion_receipts.sql | tests/integration/asset-deletion.test.ts：HTTP/权限/引用守卫/磁盘失败/重启/导出恢复；M9 旧快照 reconciliation 仍待补 |

## SYNC — 同步

| ID | 代码 | 测试 |
| --- | --- | --- |
| SYNC-1/2 | mobile/src/state/AppContext.tsx(authorizeUpload)、src/screens/SyncConsentScreen.tsx | mobile/tests/sync-consent.test.ts、first-run-flow.test.ts |
| SYNC-3 | mobile/src/sync/(core/sync).ts isCurrent 栅栏 | mobile/tests/sync-core.test.ts |
| SYNC-4/5 | app/api/uploads/*、lib/imports/service.ts | tests/integration/resumable-upload.test.ts、resumable-restart.test.ts |
| SYNC-6 | captureId 幂等(lib/imports) | tests/integration/resumable-upload.test.ts(409 case) |
| SYNC-7 | lib/mobile/sync.ts | tests/integration/mobile-api.test.ts(增量待补) |
| SYNC-8 | db/schema/memory.ts(_revision)、lib/memories/service.ts | tests/integration/memory-edit.test.ts、merge.test.ts |
| SYNC-9 | mobile/src/screens/SettingsScreen.tsx、src/state/device-clear | mobile/tests/device-clear.test.ts |
| SYNC-11 | mobile/src/rescue/(rescue-package/device).ts | mobile/tests/rescue-package.test.ts |

## FAM — 共写与贡献

| ID | 代码 | 测试 |
| --- | --- | --- |
| FAM-1 | lib/contributions/service.ts、app/api/mobile/v1/memories/[id]/contributions | tests/integration/contribution.test.ts |
| FAM-3 | app/(protected)/contribute/[token] | tests/e2e/contribution.spec.ts |
| FAM-4 | lib/contribution-portals/service.ts | tests/integration/contribution-portals.test.ts |
| FAM-5 | contribution_portal_submission、lib/inbox | tests/integration/inbox.test.ts |
| FAM-6 | mobile/src/notifications/review-reminders.ts | mobile/tests/review-reminders.test.ts(SMTP 未实现) |
| FAM-7 | lib/oral-history | tests/integration/oral-history.test.ts |
| FAM-8 | lib/transcripts(revision) | tests/integration/transcription.test.ts |

## AI — 双路由

| ID | 代码 | 测试 |
| --- | --- | --- |
| AI-1/2/3/4 | lib/ai/config.ts、dual-route.ts、mimo-asr.ts、openai-compatible.ts | tests/unit/ai-dual-route-config.test.ts、ai-dual-route-assistant.test.ts、ai-mimo-asr.test.ts |
| AI-5 | app/(protected)/(app)/settings/ai、app/api/mobile/v1/ai/settings | tests/integration/ai-settings、tests/e2e/ai.spec.ts |
| AI-6 | scripts/ops/lib/ai.py、scripts/ai-diagnostics.mts | tests/ops/ai-config.test.ts |
| AI-7/15/16 | lib/naming.ts、lib/names | tests/integration/name-review.test.ts、naming 单测 |
| AI-8 | lib/ai/handlers/analyze-asset-image.ts、lib/ai/image-preview.ts | tests/unit/ai-analyze-image.test.ts |
| AI-9 | lib/transcripts、lib/ai/handlers/transcribe-asset.ts | tests/integration/transcription.test.ts |
| AI-10 | lib/ai/handlers/analyze-asset-video.ts、lib/media/(ffmpeg/frames) | tests/unit/ffmpeg-frames.test.ts、tests/integration/video-*.test.ts |
| AI-11 | lib/ai/handlers/suggest-*、lib/inbox/merge | tests/integration/inbox-suggestions.test.ts、merge.test.ts |
| AI-12 | lib/ai/handlers/(generate-story/optimize-review-story) | tests/integration/review.test.ts |
| AI-13 | lib/ai/jobs/service.ts、jobs/(runtime/registry/worker).ts | tests/unit/ai-worker.test.ts、tests/integration/organizer-dependencies.test.ts |
| AI-14 | lib/ai/organizer | tests/integration/organizer-dependencies.test.ts |
| AI-17 | lib/facts/source-refs | tests/integration(story sources) |
| AI-18 | lib/authz/contribution-access | tests/integration/contribution-visibility.test.ts |
| AI-19/20 | db/schema/ai-job(consent)、lib/ai/capabilities | tests/e2e/ai.spec.ts |
| AI-21 | lib/ai/jobs/service.ts(配额待补) | — |
| AI-22 | lib/ai/validation.ts、lib/ai/handlers/suggest-asset-name.ts | tests/integration/asset-name.test.ts：OCR 注入、URL/晚到建议拒绝；全部链路统一专项仍待补 |
| AI-23 | scripts/ai-diagnostics.mts、ftc ai test | live 凭据外部阻塞 |

## FIND — 检索与回顾

| ID | 代码 | 测试 |
| --- | --- | --- |
| FIND-1 | lib/search/(service/tokenizer).ts、db/migrations/0023 | tests/integration/search.test.ts |
| FIND-2 | app/(protected)/(app)/search、app/api/mobile/v1/search | tests/e2e(搜索项目) |
| FIND-3 | lib/search/natural-language.ts、app/(protected)/(app)/search/page.tsx | tests/unit/search-natural-language.test.ts |
| FIND-4 | scripts/benchmark-search-nl.mts（关键词基线与理想上限，不是真实模型测评） | fake 失败关闭；真实模型对比未完成 |
| FIND-5 | lib/clusters | tests/integration(clusters) |
| FIND-6 | lib/memories/resurfacing | tests/integration/resurfacing.test.ts |
| FIND-7 | lib/memories/calendar、mobile CalendarScreen | tests/integration/calendar.test.ts |
| FIND-8 | lib/review、lib/books/(review/render) | tests/integration/review.test.ts、book-publication.test.ts |
| FIND-9 | 部分未实现 | — |

## WORK — 相册与作品

| ID | 代码 | 测试 |
| --- | --- | --- |
| WORK-1 | lib/collections、app/(protected)/(app)/collections | tests/integration/collections.test.ts |
| WORK-2 | lib/books/(service/projects/layout) | tests/integration/book-projects.test.ts、books.test.ts |
| WORK-3 | mobile/src/screens/BookScreens.tsx | mobile/tests/book-screens.test.ts |
| WORK-4 | lib/books/review | tests/integration/book-review.test.ts |
| WORK-5 | lib/books/render/(pdf/epub)、render/legacy-pdf | tests/integration/book-publication.test.ts(EPUBCheck) |
| WORK-6 | lib/books/render/jobs.ts | book-publication(cancel/retry cases) |
| WORK-7 | lib/reading | tests/integration/reading-package.test.ts |
| WORK-8 | lib/capsules/(service/dialogue) | tests/integration/capsule.test.ts |
| WORK-9 | mobile/src/reading/(engine/native) | mobile/tests/reading-*.test.ts |

## OPS/BKP/SEC/BIZ/REL

| ID | 代码 | 测试 |
| --- | --- | --- |
| OPS-1..14 | scripts/ops/*(ftc 及全部子命令) | tests/ops/ops-suite.test.ts、release-registry.test.ts、compose-config.test.ts |
| OPS-10/12 | scripts/ops/lib/(releases.json/release_tool.py)、.github/workflows/mobile-build.yml | tests/ops/release-registry.test.ts |
| BKP-1/2 | lib/export/service.ts、scripts/restore.ts | tests/integration/export.test.ts、restore.test.ts、tests/roundtrip |
| BKP-3 | lib/webdav、scripts/ops/backup.sh | tests/integration/webdav-backup.test.ts、tests/ops |
| BKP-6 | tests/roundtrip/restore-roundtrip.test.ts | 同左 |
| BKP-7 | scripts/ops/upgrade.sh、templates/maintenance.Caddyfile | tests/ops(A类11/B类23/13/C类14/D类25) |
| BKP-9 | scripts/ops/restore.sh | tests/ops |
| BKP-10 | 未实现 | — |
| SEC-1 | docs/SECURITY.md | 人工审查 |
| SEC-3 | docs/AI_PRIVACY.md、AI_PROVIDERS.md | 人工审查+文案测试 |
| SEC-7 | resources/fonts(OFL)、待补全台账 | — |
| REL-1 | 全部 | 见 ACCEPTANCE.md |
| REL-5 | .github/workflows/ci.yml | CI 本身 |

## M3-C 原件资料库补充（2026-09-07）

0053 增加资料人物/metadata revision 与相册 asset 引用；0054 重建 ai_suggestion 增加 asset 类型并保留旧审核历史；0055 保存原件删除记录和本地清理进度。asset-library-migration.test.ts 用真实 0052 数据库验证升级，不清库、不修改旧迁移。

资料补标题复用 NameReview；AI 起名复用既有 CPA/Luna + MiMo/ASR 任务依赖、按证据生成并需人工采用。新增 asset-name.test.ts 覆盖恶意 OCR、禁止 URL、审核导出与晚到结果；不代表真实 provider 验收。原生组件测试覆盖 30 份资料/5 份引用、未整理录音阅读、时间人物修改、显式删除与账号切换晚到响应。

## M3-D intake 去向补充（2026-09-07）

0056 为 import session 增加 intake 目的地（draft/library）与 revision。Web `/imports/[id]` 提供去向选择面板（新草稿/仅存资料库），`app/api/imports/[id]/destination` 服务端裁决；系统分享（`/share`）先保全原件再选去向，加入已有草稿只组成一件事。原生端 intake store/recovery/sync（mobile/src/native/intake-store.ts、intake-recovery.ts、intake-sync.ts）持久化去向选择并随同步上传。集成/原生/e2e 测试见 CAP-1/CAP-6 行；导出恢复包含 intake 关系。
