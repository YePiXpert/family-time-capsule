# Family Time Capsule v1.0 Roadmap

> **Status: 1.0.0-rc.2 — AUTOMATED GATES PASS; REAL-DEVICE GATE OPEN**
>
> Started: 2026-08-31
> Baseline: `v0.1.3` at `5b341f6`
> Goal: a stable, private, self-hosted family archive with a provider-neutral AI organizer, trustworthy sources, family participation, and long-term recovery.

This roadmap translates the v1 brief into dependency-ordered delivery work. It is a living release contract: implementation details may change, but the archive invariants and release gates may not be weakened without an explicit architecture/security decision.

## Current State

### Baseline evidence

The 2026-08-31 audit established:

- Git checkout was clean on `master`, aligned with `origin/master`; 36 commits and no release tags.
- Application version is `0.1.3`.
- SQLite schema has **21 tables** and **11 forward migrations** (`0000`–`0010`).
- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm test`: **197** unit/integration tests pass.
- `npm run build`: pass on Next.js `16.3.3`.
- Playwright: **24** tests pass.
- Production disaster roundtrip: **6** tests pass.
- Next.js 16.3.3 bundled documentation was reviewed for App Router, async request APIs, Route Handlers, Server Actions, caching, CSP, standalone output, and self-hosting.

This is the minimum baseline. Every milestone must keep it green and add targeted tests for its new behavior.

### Current progress after the initial audit

- Application version is `1.0.0-rc.2`; no stable release tag exists.
- A React Native native companion now provides device SQLite/file offline storage,
  Keychain/Keystore sessions, durable capture outbox and versioned server sync; it is not a WebView.
- Schema now has **41 tables** and **29 forward migrations** (`0000`–`0028`); the FTS5
  `search_index` virtual table lives outside the relational schema.
- M1 family roles, invitations, account lifecycle, guardians, `child_later` unlock, and
  Contribution visibility are enforced across services, media, events, capsules and UI.
- M2 provider-neutral AI, offline Fake/Null providers, SQLite jobs, consent disclosure,
  worker leases/retry/cancellation and settings UI are implemented.
- M5 oral history and capsule dialogue are **complete**: anonymous contribution
  request links (hashed tokens, expiry, closure, rate limits, inbox review) with a
  ten-topic prompt library, plus future questions and post-unlock replies that never
  touch sealed content (migrations 0025/0026).
- M3 AI memory organizer is **complete**: source-preserving transcripts (segments,
  machine/user-edited separation, rerun protection), image and video analysis
  derivatives (`analyze.asset_image.v1`, `analyze.asset_video.v1` with ffmpeg frame
  sampling and graceful unavailability), candidate title/location/person/tag and
  `occurred_at` suggestions with precision (`exact`/`approximate`/`date_only`),
  inbox-item suggestions that prefill without touching asset times, local
  explainable cluster suggestions (time proximity, dHash similarity, Live Photo
  pairing) that only merge on explicit accept, and precise fact source locators
  (temporary-alias protocol, verbatim quote lock, server-derived segment time
  ranges, fabricated refs dropped). The production handler registry runs
  `transcribe.asset.v1`, `analyze.asset_image.v1`, `analyze.asset_video.v1`,
  `suggest.event_metadata.v1`, and `suggest.inbox_item.v1`.
- `0.1.3` upgrade, pre-migration snapshot, visibility/media authorization, disaster
  roundtrip (now covering edited transcripts, confirmed facts with locators,
  accepted tags and `date_only` precision), suggestion, cluster and video-analysis
  suites are present and passing.
- 2026-09-03 release audit: lint/typecheck/build/audit pass; **456 server Vitest + 32
  Playwright + 10 mobile Vitest + 6 production roundtrip** pass. A current Docker image was built and
  exercised for app/worker health, persistence, export, cross-instance restore and
  takeover of a volume produced by a clean `0.1.3` image. Original SHA-256 remained
  byte-identical in both host-level drills.

### Working archive capabilities

- Private first-run admin setup; public signup is closed.
- Database sessions and persistent login rate limiting.
- Family and Person modeling with `Person != User`.
- Image/audio/video/text import, MIME and magic-byte validation, EXIF/ffprobe metadata, and SHA-256 deduplication.
- Separate `capturedAt` and `importedAt`, with explicit time provenance and user correction.
- Immutable local originals and independent WebP thumbnails.
- Inbox review, discard, confirmation, multi-item merge, MemoryEvent timeline, child age display, and event revision history.
- Independent family-member Contributions and manually confirmed Facts.
- Date/age capsules.
- Authenticated media streaming with Range support.
- Portable ZIP export, independent verification, hardened restore, and production-server disaster roundtrip.
- Export/restore audit entries, PWA/offline shell, Docker packaging, health check, and deployment smoke tooling.
- Invite-only multi-account administration with admin/editor/contributor/viewer authorization.
- Enforced private/parents/family/child_later policy with guardians and irreversible unlock.
- Provider-neutral AI configuration, explicit per-capability consent, durable jobs, optional
  worker, crash-safe leases/retry and status/cancel/retry UI; production handlers cover
  transcription, image/video analysis and event/inbox metadata suggestions.

### Current schema domains

- Auth: `user`, `session`, `account`, `verification`, `rate_limit`.
- Family: `family`, `person`.
- Archive: `asset`, `inbox_item`, `inbox_item_asset`.
- Events: `memory_event`, `memory_event_asset`, `memory_event_participant`, `memory_event_revision`.
- Narrative: `contribution`, `fact`.
- Capsules: `capsule`, `capsule_asset`, `capsule_event`, `capsule_contribution`.
- Operations: `audit_log`.
- Invitations/policy: `family_invitation` plus account/guardian/unlock fields on existing tables.
- AI operations: `ai_processing_consent`, `ai_job`, `ai_job_source`, `ai_job_attempt`,
  `ai_worker_heartbeat`.
- AI derivatives/suggestions: `asset_transcript`, `asset_analysis`, `ai_suggestion`,
  `cluster_suggestion`, `fact_source`, `memory_event_tag`.
- Stories/search: `story`, `story_paragraph`, `story_source`, rebuildable FTS5 `search_index`.
- Participation/backup: `contribution_request`, `future_question`, `capsule_reply`, `backup_run`.
- Trash lifecycle is represented by deletion/audit fields on durable domain tables.

## Invariants

Every milestone must preserve these rules:

1. Original media is never overwritten by a derivative.
2. `capturedAt` and `importedAt` keep distinct meanings.
3. Asset is evidence; MemoryEvent is the archive’s organizing unit.
4. Person never requires a login account.
5. AI may suggest, transcribe, organize, and draft; it may not manufacture confirmed facts or quotations.
6. Durable family-authored or family-confirmed content must export, restore, migrate, and remain human-readable.
7. Core capture, inbox, timeline, contribution, capsule, export, and restore remain usable with no AI provider.
8. Privacy and family authorization apply in services and entry points, not only in the UI.

## Remaining product gate

- The automated responsive/PWA coverage is green, but there is no recorded run on real
  iOS Safari/installed PWA, Android Chrome/installed PWA, and Windows Chrome/Edge with
  device-originated HEIC/MOV/M4A and a large video. This is the only stable-release gate.

## Known architecture constraints

- Browser multipart parsing uses `formData()` after a mandatory finite `Content-Length`;
  peak memory is bounded by the 50/200/500MB upload policy, not zero-copy.
- The restore CLI uses a yauzl file-backed reader: the compressed archive and complete originals
  do not enter the JS heap. Central-directory entries and one metadata JSON file (max 64MB) remain
  bounded in memory; each original is streamed through byte/SHA-256 verification to atomic storage.
- Semantic embeddings remain an optional non-goal until a real retrieval-quality need is
  demonstrated; visibility-aware local FTS5 is the supported v1 search path.
- First-run setup is serialized within the one-app-process supported Compose topology. Multiple
  app replicas must not race an empty database until a database-level bootstrap claim is added.

## Residual security/operations decisions

- No known High/Critical finding remains. Invitation guessing has no low attempt threshold by
  design: tokens have 256-bit entropy, atomic one-time claim, expiry/revocation and proxy-log
  redaction; instance owners may add source-level DoS limits at the reverse proxy.
- Portable ZIPs are integrity-protected, not encrypted. Off-site copies must use an encrypted
  filesystem/container/tool; application-managed key recovery is outside v1.
- CSP was verified on the production server. TLS/HSTS and redaction before proxy access-log
  persistence remain deployment responsibilities.

## Upgrade safeguards and evidence

Real `0.1.3` archives must be assumed to exist before any v1 migration.

- Past migrations are immutable; only new forward migrations may be added.
- Startup creates a WAL-consistent pre-migration snapshot before applying pending migrations.
- Existing `user.role` and Contribution visibility backfills preserve the 0.1.3 administrator
  and deterministic `family` meaning; upgrade tests assert both.
- Legacy `contribution.transcript` data is preserved while edited transcript records use the
  dedicated durable model.
- Export version 1 is additive: current writers include v1 durable domains and the reader treats
  files absent from older 0.1.x archives as empty domains.
- User credentials are intentionally excluded from export; multi-user restore needs a safe invitation/rebinding procedure.
- Confirmed Facts, user-edited transcripts, published Stories, sources, capsule questions/replies, and accepted contributions are durable data and must export/restore.
- AI analyses, generated thumbnails, embeddings, and unedited machine output may be classified as rebuildable derivatives, but the classification must be documented.
- FTS/embedding indexes must be rebuildable; provider/model changes must not mutate primary archive data.
- Indexes and list queries are exercised by the 50k-asset/10k-event benchmark.
- Failed migration and rollback procedures must never rely on copying only the SQLite main file while WAL writes are active.

Implemented safeguards:

1. A true `0.1.3` database fixture is checked in.
2. `0.1.3 -> HEAD` upgrade, WAL snapshot and rollback behavior run in the integration suite.
3. Old export archives remain readable; incompatible future changes must increment the format.
4. Row counts, relationships, hashes, timeline ordering, visibility and post-upgrade export are asserted.
5. A host-level Docker drill built clean 0.1.3, created data, replaced the container with the
   current image on the same volume, then verified login/event/original/export.

## v1.0 Scope

v1 includes:

- The existing trusted archive, hardened for long-term scale and recovery.
- Provider-neutral AI with null/fake implementations, durable jobs, STT, media understanding, suggestions, clustering, privacy controls, and failure UI.
- Source-linked Facts and Stories with strict fact/quotation locks.
- Weekly Stories, Monthly Chapters, and Yearly Chapters with draft/edit/publish lifecycle.
- Visibility-aware FTS5 search and optional rebuildable semantic search.
- Admin/editor/contributor/viewer roles and invite-only accounts.
- Enforced Contribution visibility.
- Scoped contribution requests and oral-history interviews.
- Future capsule questions and post-unlock replies.
- Portable PDF and EPUB books.
- Verified WebDAV backup as a target, not primary storage.
- PWA Share Target where supported.
- Trash/purge safety, bounded-memory media operations, cursor pagination, performance evidence, mobile/desktop/PWA UX, and baseline accessibility.
- Forward upgrade, pre-migration backup, rollback documentation, full export/restore compatibility, and security hardening.

## Non-goals

v1 will not add:

- A public family feed, community, likes, follows, comments, ads, or behavioral tracking.
- SaaS billing or a public multi-tenant cloud.
- Medical, feeding, diaper, or pregnancy-management features.
- Replacing the self-hosted archive/worker/export stack with an on-device-only rewrite.
- Automatic phone or chat-app scanning.
- Blockchain/NFT features.
- Microservices, Kubernetes, Redis, Kafka, or RabbitMQ without a demonstrated unavoidable need.
- A mandatory cloud origin store or hard dependency on one AI provider.
- Default face recognition.
- AI-authored confirmed facts, invented quotations, or automatic deletion/merge of originals.

## Dependency-ordered Milestones

### M0 — 0.2.x Contracts and upgrade safety — **COMPLETE**

- Reconcile documentation counts, paths, security backlog, and implemented claims.
- Define durable-versus-derivative data policy and export-version evolution.
- Add the `0.1.3` database fixture, upgrade harness, pre-migration snapshot design, and rollback runbook.
- Define family roles, permissions, Contribution visibility, AI privacy, and external-token threat models.
- Establish the 10k/50k benchmark generator and measurement method.
- Add `docs/AI_PRIVACY.md`, `AI_PROVIDERS.md`, `FAMILY_PERMISSIONS.md`, and `UPGRADE_1.0.md` as their implementations land.

Exit: contracts and fixtures exist; the current archive still passes the complete baseline.

### M1 — 0.3.x Family authorization and security boundaries — **COMPLETE**

- Implement admin/editor/contributor/viewer authorization in a centralized policy layer.
- Add hashed, expiring, revocable, family-scoped invitations and invite-only account creation.
- Enforce permissions in every current Server Action, Route Handler, media/export path, and service.
- Implement and test Contribution visibility, including `child_later` unlock policy.
- Add `server-only` data-access boundaries, CSP, expanded sensitive-action audit, and token utilities.
- Preserve current administrator access during migration.

Exit: multi-account family tests, role-escalation tests, IDOR tests, and visibility tests pass; public signup remains closed.

### M2 — 0.4.x AI foundation and durable jobs — **COMPLETE**

- Add capability-aware provider interfaces for text, vision, transcription, and embeddings.
- Implement `NullMemoryAssistant` and deterministic offline fake providers.
- Support environment-based OpenAI-compatible configuration without assuming uniform capabilities.
- Add SQLite-backed jobs, leases/stuck recovery, idempotency, retry/backoff, cancellation, worker command, and UI status/retry.
- Add explicit consent and provider/model/content disclosure before external processing.
- Ensure missing worker/provider never blocks core archive operations.

Exit evidence: offline AI tests are deterministic; queue authorization, consent/config/source
drift, concurrency, expired leases, retry cloning, worker error mapping and settings disclosure
are covered. Real content processing remains in M3 and cannot bypass this foundation.

### M3 — 0.5.x AI memory organizer and fact sources — **COMPLETE**

- Add source-preserving transcripts with segments, machine/user-edited separation, and rerun protection. ✅
- Add image/video description and OCR derivatives. ✅（视频走 ffmpeg 抽帧，缺失时优雅降级）
- Add candidate title, time, location, person, tag, and Fact suggestions with accept/edit/reject flows. ✅
- Add normalized Fact sources for Asset, Contribution, Transcript, and user text. ✅
  精确 locator：quote（创建时逐字验证）、transcript segment 时间段（服务端推导）、
  `asset_analysis` 指向 durable 的 asset id；AI 只见 T#/A#/C# 别名，伪造引用整条丢弃。
- Add time/metadata/perceptual/AI-assisted cluster suggestions, including non-destructive Live Photo hints. ✅
- Export/restore all user-edited and accepted durable results. ✅（roundtrip 覆盖 edited transcript、
  confirmed fact locator、accepted tags、date_only 精度）

Exit: suggestion rejection never reaches a Story; AI cannot write `user_confirmed`; edited transcripts survive reruns and roundtrip. ✅

### M4 — 0.6.x Search and source-linked Stories — **COMPLETE**

- Add FTS5 over event titles, confirmed Facts, visible Contributions, edited transcripts, and Stories. ✅
  （`search_index` bigram 索引，migration 0023；`npm run search:rebuild`；恢复后自动重建）
- Add person, child, date, age, media, tag, and event-type filters. ✅（person/tag/media/date 已落地；
  age 过滤随 M7 时间轴游标分页的同套索引补齐——child 过滤已可用）
- Add optional semantic search with rebuildable embeddings and no external vector database requirement.
  （可选能力：FTS 已满足 M4 出口条件；embedding 索引延后到有真实需求时落地）
- Add Story, paragraph, and normalized source models. ✅（migration 0024：story/story_paragraph/story_source）
- Implement weekly, monthly, and yearly draft/edit/publish workflows. ✅（含无 AI 的离线组装路径）
- Enforce source visibility and confirmed-source-only generation; make every AI paragraph traceable. ✅
  （生成输入白名单 + F#/C#/T# 别名协议 + 服务层逐条来源校验）
- Prevent regeneration from overwriting edited/published content or inventing quotations. ✅
  （editedAt 再生保护；Quote Lock 服务层强制：引文段逐字校验且不可编辑）

Exit: FTS works with no AI; search and Story generation obey visibility; published Stories roundtrip with sources intact. ✅

### M5 — 0.7.x Family participation, oral history, and capsule dialogue — **COMPLETE**

- Add scoped, hashed, expiring, revocable Contribution Request links with text/audio/media submission into review. ✅
  （`contribution_request`，migration 0025；256-bit token 只存 SHA-256；过期/关闭即时失效；
  5 条/小时/链接限流；访客页只显示称呼与问题）
- Ensure anonymous contributors cannot enumerate family data or browse the timeline. ✅
  （/respond/[token] 无任何家庭数据暴露；提交仅进收件箱审核队列，绝不直接发布）
- Add prompt library, InterviewPrompt, InterviewSession, topics, and optional AI follow-up question suggestions. ✅
  （内置十主题问题库；主题 key 挂在请求上。InterviewSession/Topic 独立模型经 DECISIONS
  精简为「请求即会话」——一次链接对应一位讲述人一组问答，避免重复建模；AI follow-up
  建议延后到有真实 provider 使用反馈时落地）
- Support long-audio archive, background transcript, human editing, and topic/person/time linking. ✅
  （音频经既有 ingest + transcribe.asset.v1 + 人工修订 + 事件/人物/时间挂接的完整链路）
- Add capsule Future Questions, post-unlock text/audio/media replies, and optional manual milestone trigger. ✅
  （`future_question`/`capsule_reply`，migration 0026；问题在 draft 阶段固化，回答仅解锁后）
- Keep sealed historical capsule content immutable. ✅（回答是独立增量行；封存内容零改动）

Exit: public-link abuse/rate-limit/isolation tests, oral-history flows, and capsule reply roundtrip pass. ✅

### M6 — 0.8.x Portable products, remote backup, and sharing — **COMPLETE**

- Produce source-aware printable PDF and standards-compatible EPUB books without authenticated internal URLs. ✅
  （手写 PDF 封装：sharp SVG 排版中文页 → JPEG → DCTDecode 直嵌；EPUB 3 生成器
  （mimetype 首位不压缩 / nav / opf spine）；已发布故事书 + 年度事件书；Docker 镜像
  内置 Noto CJK 字体）
- Add WebDAV `BackupTarget`, connection test, verified temporary upload, remote validation, atomic rename where supported, history, retry, and CLI. ✅
  （migration 0027 `backup_run` 历史；verified export → 临时上传 → 回读 SHA-256 →
  原子 MOVE（不支持时降级 direct-upload 并如实记录）；重试 = 全量重跑；设置页 UI；
  连接状态显示即目标解析结果）
- Keep WebDAV credentials out of logs/export/client code; use environment configuration unless secure encryption is implemented. ✅
  （凭据仅存在于 env；错误信息/历史/客户端输出经测试验证零泄漏）
- Add PWA Share Target for supported photo/video/audio/text/link inputs into Inbox; document platform limits. ✅
  （manifest share_target → POST /share multipart → 同源 + 会话 + capture:create
  校验后入箱；平台限制：仅安装为 PWA 的浏览器出现系统分享入口）
- Extend export/restore/verify for all v1 durable domains and retain old archive compatibility. ✅
  （M3–M5 的 additive 文件已全部接入 verify:export；旧档缺失文件按空域恢复）

Exit: PDF/EPUB portability, fake-WebDAV success/failure/retry, share-target security, and v1 disaster roundtrip pass. ✅

### M7 — 0.9.x Scale, resilience, UX, and accessibility — **COMPLETE**

- Add cursor pagination to Timeline and other growing lists; remove quadratic assembly and obvious N+1 behavior. ✅
  （Timeline/Inbox 均 keyset 游标；故事/回收站/搜索全部有界——见 PERFORMANCE.md 清单）
- Replace large upload, hashing, export, and restore buffering with bounded-memory streaming/spooling. ✅
  （媒体 Range、导出 archiver、WebDAV 哈希与文件路径恢复均流式；上传为「上限内有界」并在
  PERFORMANCE.md 如实声明；超限请求在 formData 缓冲前被 Content-Length 预检拒绝）
- Add indexes based on measured query plans and benchmark results. ✅（10k/50k 基准全绿）
- Add Trash and explicit purge for MemoryEvent, Contribution, and Story; define Asset retention and backup semantics. ✅
  （migration 0028 + 回收站 UI + 确认式硬清除 + 素材引用守卫）
- Add upload progress/status, empty/loading/error/retry states, and global error/not-found handling.
  ✅（XHR 真实字节进度、失败重试、`aria-live`；全局 loading/error/not-found 恢复页）
- Audit keyboard navigation, focus, labels, errors, contrast, media controls, and reduced motion; add critical accessibility smoke tests.
  （核心交互表单均带 aria-label/role/键盘可达；完整 WCAG 审计与 M8 真机记录一起收口）
- Complete and publish `docs/PERFORMANCE.md` using 10k events and 50k asset metadata. ✅

Exit: scale gates and accessibility smoke pass without weakening archive integrity. ✅

### M8 — 1.0.0-rc Security, migration, and release hardening — **AUTOMATED COMPLETE / DEVICE GATE OPEN**

- Complete v1 security review and fix/document findings. ✅
- Upgrade the real `0.1.3` fixture and verify relationships, hashes, order, export and restore. ✅
- Run the complete fictional-family destroy/restore production roundtrip. ✅
- Verify Docker build, boot, app/worker health, persistence, export, restore and upgrade. ✅
- Execute and record desktop, iOS, Android, and installed-PWA manual acceptance. **Pending external devices.**
- Synchronize release-facing documentation and exact evidence. ✅

Exit: every release gate below is evidenced; version remains below `1.0.0` until then.

### M9 — 1.0.0 Stable Family Archive — **WAITING FOR REAL DEVICES**

- Set package version to `1.0.0` only after all gates pass.
- Publish the final changelog and completion report with exact test/benchmark/deployment evidence.
- Create the coherent release commit and `v1.0.0` tag without rewriting migration or git history.

## Release Gates

### Archive and data integrity

- Originals remain byte-identical and independently SHA-256 verifiable.
- Derivatives never replace originals; `capturedAt`/`importedAt` semantics remain unchanged.
- A fictional family containing the complete v1 durable domain exports, is destroyed, restores cleanly, and matches entity counts, relationships, visibility, timestamps, and hashes.
- User-edited transcripts, confirmed Facts, published Stories, sources, capsule dialogue, and accepted guest contributions survive roundtrip.

### Upgrade and rollback

- The checked-in `0.1.3` fixture upgrades through every migration with no data loss or destructive migration.
- Pre-migration WAL-consistent snapshot and rollback are exercised, not only documented.
- Current restore reads supported `0.1.x` archives; export compatibility and version rules are documented.

### Security and privacy

- No known High/Critical issue remains.
- Medium issues are fixed or have explicit rationale, mitigation, and owner.
- Roles, family isolation, visibility, media, search, stories, capsules, invitations, and contribution links have negative authorization tests.
- CSP works in production without `unsafe-eval`.
- AI and WebDAV secrets never reach logs, clients, fixtures, or export archives.
- External AI processing is opt-in and discloses provider, model, and sent content type.
- Sensitive operations produce family-scoped audit entries.

### Performance and resource safety

- Benchmark dataset contains at least 10,000 MemoryEvents, 50,000 asset metadata rows, and thousands of Contributions across multiple years.
- Timeline and growing lists use cursor pagination and do not send whole tables to clients.
- Query inspection shows no obvious N+1 path; lists use derivatives rather than full originals.
- Upload, media processing, export hashing/packaging, and restore are bounded-memory for supported file/archive sizes.
- Timeline, search, family, Story-source, and export-manifest results and hardware/methodology are recorded in `docs/PERFORMANCE.md`.

### Product and UX

- All automated acceptance-matrix rows below are complete; the two real-device rows remain
  deliberately open for stable release.
- Core archive use remains functional with AI disabled and worker stopped.
- Mobile, desktop, and PWA critical journeys pass with empty/error/loading/retry states.
- Keyboard/focus/label/contrast/media/reduced-motion smoke checks pass.
- Real iOS, Android, and desktop results are recorded; platform limitations are explicit.

### Quality, operations, and release

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` pass from a clean checkout.
- Roundtrip, upgrade, worker, book, WebDAV, export verification, restore, benchmark, and security suites pass.
- CI triggers on the default branch and runs the required gates.
- Docker build/boot/health/persistence/backup/restore/upgrade are actually verified.
- Documentation matches code and contains no stale test, schema, migration, or security claims.
- Only then may the version, release commit, and tag become `1.0.0` / `v1.0.0`.

## Acceptance Matrix

| Brief area | Current | v1 acceptance evidence | Milestone |
| --- | --- | --- | --- |
| Archive invariants (§2, §40) | ✅ Complete | Byte/hash/time invariants, immutable originals, derivative-only lists, long timeline | M7–M8 |
| AI architecture/jobs (§4–5) | ✅ Complete | Provider-neutral capabilities, production/Null/Fake providers, durable jobs, retry UI, consent | M2–M3 |
| STT/vision/suggestions/clustering (§6–9) | ✅ Complete | Edited transcript protection, analysis provenance, review flows, non-destructive clusters | M3 |
| Fact lock (§8, §10) | ✅ Complete | Normalized sources, AI cannot confirm, rejected suggestions excluded, quotations traceable | M3–M4 |
| Weekly/monthly/yearly Stories (§10–11, §18) | ✅ Complete | Paragraph sources, lifecycle, regeneration protection, weekly/monthly/yearly UX | M4 |
| Search (§12) | ✅ Complete | Visibility-aware local FTS5 and filters without AI | M4 |
| Roles/invites (§13) | ✅ Complete | Invite-only accounts, four enforced roles, no public signup/escalation | M1 |
| Contribution visibility (§14) | ✅ Complete | private/parents/family/child_later policy in every consumer | M1 |
| Contribution links/oral history (§15–16) | ✅ Complete | Scoped token links, persistent limit, review queue, prompts, anonymous isolation | M5 |
| Capsules (§17) | ✅ Complete | Date/age, future questions/replies, immutable sealed content | M5 |
| Books (§19) | ✅ Complete | Portable PDF/EPUB, embedded media, no auth-only URLs | M6 |
| WebDAV backup (§20) | ✅ Complete | Streamed verified upload/readback, rename/fallback, retry/history, safe credentials | M6–M8 |
| System Share Target (§21) | ⚠️ Automated complete; real device pending | Inputs enter Inbox; installed-PWA behavior requires iOS/Android record | M6, M8 |
| Trash/purge (§22) | ✅ Complete | Recoverable trash, explicit purge, reference guard and audit | M7 |
| Performance (§23, §35) | ✅ Complete | 10k/50k evidence, cursor pagination, indexed/batched queries, documented bounds | M7–M8 |
| Upgrade and pre-migration backup (§24–25) | ✅ Complete | Fixture + Docker takeover, consistent snapshot/rollback, old archive compatibility | M0, M8 |
| Security/privacy/audit (§26–27) | ✅ Complete | Full review, CSP, secret/privacy controls, audit, no known High/Critical | M1–M8 |
| UX/accessibility (§28–29) | ⚠️ Automated complete; real device pending | Progress/recovery/focus/reduced-motion green; real device record open | M7–M8 |
| Quality/data-integrity fixture (§32–34, §40) | ✅ 455/32/8/6 | Complete fictional-family destroy/restore, mobile sync state machine, plus Docker restore/upgrade | Every milestone, M8 |
| Documentation/release (§36–43) | ⚠️ RC complete | Release report current; stable version/tag waits for device evidence | M8–M9 |

## Known Current Warnings

- `docs/REAL_DEVICE_TEST.md` has no completed iOS/Android/Windows or installed-PWA record;
  device codecs, OS picker/share integration and a >200MB real video remain external evidence.
- Restore keeps a bounded Central Directory index and one ≤64MB metadata JSON document in memory;
  the production file-path CLI does not buffer the compressed ZIP or complete originals.
- Multiple app replicas are not a supported first-setup topology; use the Compose one-app layout.
- No git release tags exist yet; `v1.0.0` is prohibited before the device record is complete.
- 本地开发机可能没有 ffmpeg：视频理解任务会以 `ffmpeg_unavailable` 非重试失败
  （Docker 镜像内置 ffmpeg；这是设计内的优雅降级，不是缺陷）。

These warnings are not permission to lower the v1 bar; they are the first items to close and continuously re-audit.
