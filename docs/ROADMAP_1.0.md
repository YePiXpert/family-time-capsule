# Family Time Capsule v1.0 Roadmap

> **Status: IN PROGRESS**
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

- Application version intentionally remains `0.1.3`; no release tag exists.
- Schema now has **33 tables** and **23 forward migrations** (`0000`–`0022`).
- M1 family roles, invitations, account lifecycle, guardians, `child_later` unlock, and
  Contribution visibility are enforced across services, media, events, capsules and UI.
- M2 provider-neutral AI, offline Fake/Null providers, SQLite jobs, consent disclosure,
  worker leases/retry/cancellation and settings UI are implemented.
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
  worker, crash-safe leases/retry and status/cancel/retry UI; no real content handler yet.

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

## Product Gaps

- No Story model or weekly/monthly/yearly publishing workflow.（M4）
- No full-text or semantic search.（M4）
- No scoped contribution links, oral-history prompts, or interview workflow.（M5）
- Capsules have no future questions, replies, or milestone trigger.（M5）
- No PDF/EPUB books, WebDAV backup, or PWA Share Target.（M6）
- No event/contribution/story trash and explicit purge lifecycle.（M7）
- Upload status is coarse and has no byte progress or resumable behavior.（M7）
- Inbox has no pagination; growing lists still need cursor pagination everywhere.（M7）
- No completed accessibility audit or recorded real-device acceptance run.（M7–M8）

## Architecture Gaps

- `contribution.transcript` is only a placeholder column; it lacks provenance, segments, edit protection, and export/restore support.
- Facts have no normalized source relationship.
- No Story/StoryParagraph/StorySource, tag, analysis, suggestion, embedding,
  contribution-request, or interview schemas.
- Inbox remains unbounded.
- Timeline, inbox, capsules, and export contain repeated per-row array scans that will not scale to the v1 dataset.
- Upload routes buffer complete files; export hashes complete files synchronously; restore retains the whole ZIP and all extracted originals in memory.
- No 10k-event/50k-asset benchmark harness or `docs/PERFORMANCE.md`.
- No explicit `server-only` data-access boundary for database and secret-bearing modules.
- No global error/not-found/loading recovery surfaces.

## Security Gaps

- No public-contribution token security model.
- Real AI content handlers still require per-capability result/source/deletion threat reviews;
  the consent, disclosure, secret and queue boundary is implemented.
- No WebDAV SSRF/redirect/credential threat model.
- Audit covers export/restore, invitations, account/guardian/unlock policy and AI consent/job
  controls; trash/purge, WebDAV and backup audit remain.
- Setup-specific brute-force protection and backup encryption remain documented backlog items.
- Future search, stories, books and new capsule domains still need visibility/isolation tests.
- No complete v1 security review or production-proxy CSP verification.

## Data Migration Risks

Real `0.1.3` archives must be assumed to exist before any v1 migration.

- Past migrations are immutable; only new forward migrations may be added.
- Startup currently migrates automatically without first creating a WAL-consistent snapshot.
- Existing `user.role` values default to `admin`; RBAC migration must preserve access and avoid locking out the current administrator.
- Existing Contributions default to `family`; visibility migration must preserve that deterministic meaning while enforcing new policy.
- The nullable `contribution.transcript` column must migrate without losing any non-null legacy value if transcripts move to a dedicated model.
- Export version 1 currently omits transcripts and all future v1 durable domains.
- User credentials are intentionally excluded from export; multi-user restore needs a safe invitation/rebinding procedure.
- Confirmed Facts, user-edited transcripts, published Stories, sources, capsule questions/replies, and accepted contributions are durable data and must export/restore.
- AI analyses, generated thumbnails, embeddings, and unedited machine output may be classified as rebuildable derivatives, but the classification must be documented.
- FTS/embedding indexes must be rebuildable; provider/model changes must not mutate primary archive data.
- New indexes and backfills must be tested at 50k assets/10k events for lock duration, disk growth, and restart behavior.
- Failed migration and rollback procedures must never rely on copying only the SQLite main file while WAL writes are active.

Required safeguards:

1. Check in a true `0.1.3` database fixture before changing the schema substantially.
2. Add a `0.1.3 -> HEAD` upgrade test and run it on every later migration.
3. Create a WAL-consistent pre-migration snapshot and document restore/rollback.
4. Test old export archives against the current reader and version all incompatible export changes.
5. Verify row counts, relationships, hashes, timeline ordering, visibility, and export after every upgrade.

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
- Native React Native/Flutter/Capacitor rewrites solely for sharing.
- Automatic phone or chat-app scanning.
- Blockchain/NFT features.
- Microservices, Kubernetes, Redis, Kafka, or RabbitMQ without a demonstrated unavoidable need.
- A mandatory cloud origin store or hard dependency on one AI provider.
- Default face recognition.
- AI-authored confirmed facts, invented quotations, or automatic deletion/merge of originals.

## Dependency-ordered Milestones

### M0 — 0.2.x Contracts and upgrade safety — **IN PROGRESS**

- Reconcile documentation counts, paths, security backlog, and implemented claims.
- Define durable-versus-derivative data policy and export-version evolution.
- Add the `0.1.3` database fixture, upgrade harness, pre-migration snapshot design, and rollback runbook.
- Define family roles, permissions, Contribution visibility, AI privacy, and external-token threat models.
- Establish the 10k/50k benchmark generator and measurement method.
- Add `docs/AI_PRIVACY.md`, `AI_PROVIDERS.md`, `FAMILY_PERMISSIONS.md`, and `UPGRADE_1.0.md` as their implementations land.

Exit: contracts and fixtures exist; the current archive still passes the complete baseline.

### M1 — 0.3.x Family authorization and security boundaries

- Implement admin/editor/contributor/viewer authorization in a centralized policy layer.
- Add hashed, expiring, revocable, family-scoped invitations and invite-only account creation.
- Enforce permissions in every current Server Action, Route Handler, media/export path, and service.
- Implement and test Contribution visibility, including `child_later` unlock policy.
- Add `server-only` data-access boundaries, CSP, expanded sensitive-action audit, and token utilities.
- Preserve current administrator access during migration.

Exit: multi-account family tests, role-escalation tests, IDOR tests, and visibility tests pass; public signup remains closed.

### M2 — 0.4.x AI foundation and durable jobs — foundation complete

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

### M4 — 0.6.x Search and source-linked Stories

- Add FTS5 over event titles, confirmed Facts, visible Contributions, edited transcripts, and Stories.
- Add person, child, date, age, media, tag, and event-type filters.
- Add optional semantic search with rebuildable embeddings and no external vector database requirement.
- Add Story, paragraph, and normalized source models.
- Implement weekly, monthly, and yearly draft/edit/publish workflows.
- Enforce source visibility and confirmed-source-only generation; make every AI paragraph traceable.
- Prevent regeneration from overwriting edited/published content or inventing quotations.

Exit: FTS works with no AI; search and Story generation obey visibility; published Stories roundtrip with sources intact.

### M5 — 0.7.x Family participation, oral history, and capsule dialogue

- Add scoped, hashed, expiring, revocable Contribution Request links with text/audio/media submission into review.
- Ensure anonymous contributors cannot enumerate family data or browse the timeline.
- Add prompt library, InterviewPrompt, InterviewSession, topics, and optional AI follow-up question suggestions.
- Support long-audio archive, background transcript, human editing, and topic/person/time linking.
- Add capsule Future Questions, post-unlock text/audio/media replies, and optional manual milestone trigger.
- Keep sealed historical capsule content immutable.

Exit: public-link abuse/rate-limit/isolation tests, oral-history flows, and capsule reply roundtrip pass.

### M6 — 0.8.x Portable products, remote backup, and sharing

- Produce source-aware printable PDF and standards-compatible EPUB books without authenticated internal URLs.
- Add WebDAV `BackupTarget`, connection test, verified temporary upload, remote validation, atomic rename where supported, history, retry, and CLI.
- Keep WebDAV credentials out of logs/export/client code; use environment configuration unless secure encryption is implemented.
- Add PWA Share Target for supported photo/video/audio/text/link inputs into Inbox; document platform limits.
- Extend export/restore/verify for all v1 durable domains and retain old archive compatibility.

Exit: PDF/EPUB portability, fake-WebDAV success/failure/retry, share-target security, and v1 disaster roundtrip pass.

### M7 — 0.9.x Scale, resilience, UX, and accessibility

- Add cursor pagination to Timeline and other growing lists; remove quadratic assembly and obvious N+1 behavior.
- Replace large upload, hashing, export, and restore buffering with bounded-memory streaming/spooling.
- Add indexes based on measured query plans and benchmark results.
- Add Trash and explicit purge for MemoryEvent, Contribution, and Story; define Asset retention and backup semantics.
- Add upload progress/status, empty/loading/error/retry states, and global error/not-found handling.
- Audit keyboard navigation, focus, labels, errors, contrast, media controls, and reduced motion; add critical accessibility smoke tests.
- Complete and publish `docs/PERFORMANCE.md` using 10k events and 50k asset metadata.

Exit: scale gates and accessibility smoke pass without weakening archive integrity.

### M8 — 1.0.0-rc Security, migration, and release hardening

- Run the complete v1 security review: auth, roles, tokens, AI, privacy, CSP, CSRF, XSS, IDOR, media, upload, ZIP/restore, WebDAV, search, stories, capsules, audit, rate limits, logging, backup, and workers.
- Fix all High/Critical findings; fix Medium findings or document a specific rationale and mitigation.
- Upgrade a real `0.1.3` fixture and verify all data, relationships, hashes, timeline order, export, and restore.
- Build the complete fictional-family integrity fixture required by the brief and perform destroy/restore verification.
- Verify Docker build, boot, health, persistence, backup, restore, and upgrade on a supported host.
- Execute and record desktop, iOS, Android, and installed-PWA manual acceptance.
- Synchronize README, changelog, PRD, architecture, data model, security, decisions, issues, export/restore, deployment, real-device, and v1 topic docs.

Exit: every release gate below is evidenced; version remains below `1.0.0` until then.

### M9 — 1.0.0 Stable Family Archive

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

- All acceptance-matrix rows below are complete.
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
| Archive invariants (§2, §40) | Strong P0 base; scale gaps | Byte/hash/time invariants, immutable originals, derivative-only lists, long timeline | M7–M8 |
| AI architecture/jobs (§4–5) | Foundation implemented; production handlers empty | Provider-neutral capabilities, Null/Fake providers, durable jobs, retry/failure UI, consent | M2 |
| STT/vision/suggestions/clustering (§6–9) | Missing; placeholder transcript column | Edited transcript protection, analysis provenance, review flows, non-destructive clusters | M3 |
| Fact lock (§8, §10) | Manual confirmed Facts; no sources | Normalized sources, AI cannot confirm, rejected suggestions excluded, quotations traceable | M3–M4 |
| Weekly/monthly/yearly Stories (§10–11, §18) | Missing | Paragraph sources, draft/edit/publish, regeneration protection, weekly/monthly/yearly UX | M4 |
| Search (§12) | Missing | Visibility-aware FTS and filters without AI; optional rebuildable semantic search | M4 |
| Roles/invites (§13) | Implemented and enforced | Invite-only accounts, four enforced roles, no public signup or escalation | M1 |
| Contribution visibility (§14) | Implemented across current consumers | Documented and enforced private/parents/family/child_later policy in all consumers | M1 |
| Contribution links/oral history (§15–16) | Missing | Scoped token links, review queue, prompt/interview flow, anonymous isolation | M5 |
| Capsules (§17) | Date/age works | Existing behavior preserved; future questions, replies, immutable old content | M5 |
| Books (§19) | Missing | Portable PDF/EPUB with embedded derivatives and no auth-only URLs | M6 |
| WebDAV backup (§20) | Missing | Verified temp upload/validation/rename, retry/history/CLI, safe credentials | M6 |
| System Share Target (§21) | Missing | Supported inputs enter Inbox; platform limitations documented | M6 |
| Trash/purge (§22) | Inbox discard only | Recoverable trash, explicit purge, Asset retention and backup semantics | M7 |
| Performance (§23, §35) | No benchmark; bounded lists incomplete | 10k/50k evidence, cursor pagination, indexed/batched queries, bounded memory | M7 |
| Upgrade and pre-migration backup (§24–25) | `0.1.3` fixture and consistent snapshot implemented; final v1 upgrade pending | `0.1.3 -> 1.0` test, consistent snapshot, rollback, old archive compatibility | M0, M8 |
| Security/privacy/audit (§26–27) | Roles, visibility, CSP, invitations and AI foundation hardened; future domains pending | Full review, CSP, secret/privacy controls, expanded audit, no High/Critical | M1–M8 |
| UX/accessibility (§28–29) | Basic responsive PWA | Progress/states, mobile/desktop/PWA journeys, WCAG smoke and real-device record | M7–M8 |
| Quality/data-integrity fixture (§32–34, §40) | 197/24/6 baseline | All new suites plus complete fictional-family destroy/restore roundtrip | Every milestone, M8 |
| Documentation/release (§36–43) | P0 docs with known drift | All named v1 docs current; exact final report; version/tag only after gates | M0, M8–M9 |

## Known Current Warnings

- README/CHANGELOG test counts lag behind the current suite（文档随 M8 发布同步）。
- Inbox has no pagination.（M7）
- Upload and restore memory behavior is unsafe for their documented maximum sizes.（M7）
- Docker persistence has historical static-review evidence, not a recorded local Docker acceptance run.
- `docs/REAL_DEVICE_TEST.md` has no completed iOS/Android/desktop record.
- No git release tags exist yet.
- 本地开发机可能没有 ffmpeg：视频理解任务会以 `ffmpeg_unavailable` 非重试失败
  （Docker 镜像内置 ffmpeg；这是设计内的优雅降级，不是缺陷）。

These warnings are not permission to lower the v1 bar; they are the first items to close and continuously re-audit.
