# Mobile synchronization

The native client requests `GET /api/mobile/v1/sync?protocol=2&limit=50`.
The existing version-1 response remains available when `protocol` is omitted.
The protocol concerns server timeline/person metadata and managed read caches;
local captures, original files, private drafts and upload receipts remain separate.

## Journal and cursors

Migration `0071` adds installation-local generation, family revision/permission
revision, an append-only change journal, and opaque cursor handles. SQLite triggers
write journal records inside the same transaction as business data, including
changes made by the web process, worker, operations code, or a second connection.
A rolled-back edit cannot leave a phantom change. Journal rows contain entity IDs,
operation and audience metadata, never titles, original text, tokens or media.
These tables are rebuildable installation state and are excluded from family ZIPs.

The initial snapshot pages people and visible confirmed events separately. Each
response contains at most 50 people or events. Subsequent rounds start from the
last committed checkpoint and return changed records and authorized tombstones.
Unchanged rounds return empty lists. Deletion audience metadata permits removing
a formerly readable event without disclosing a never-readable private event ID.
Every returned live event also passes the current object authorization predicate.

Random 192-bit handles are bound to user, family, generation, permission stamp,
revision fence and a seven-day expiry. Clients cannot edit sequence numbers or
inspect family activity in cursors. At most 1,024 handles are retained per account.
Journal cleanup removes at most 1,000 rows per request from a prefix older than
30 days. A cursor behind the retained prefix requires a replacement snapshot.

An in-progress round has a fixed family revision fence. A concurrent edit returns
`409 sync_changed`; a changed generation, permission stamp, invalid/expired handle
or missing retained history returns `409 sync_reset`. Context/account checks run
again at final HTTP handoff. Person/role/guardian/family changes and object/source
permission changes invalidate affected family permission stamps; the local family
date is included to re-evaluate date-sensitive permissions. This is deliberately
conservative: some source/relationship edits require a replacement snapshot.

## Native commit and invalidation

Each page and downloaded cover reference is staged in device SQLite. The timeline,
people, capture reconciliation, deletions and checkpoint commit in one exclusive
transaction only after every page passes round identity checks. Failed/interrupted
rounds leave the previous complete cache and checkpoint intact. The next attempt
replays from that checkpoint; upserts and deletions are idempotent. Restart removes
abandoned staging rows. Automatic recovery is limited to two retries per sync.

A known `sync_reset` immediately withdraws server metadata, details, library/home
summaries, managed thumbnails and the current account's downloaded reading scope.
A failed replacement download does not make the withdrawn content readable again.
Reading transfers are stopped and awaited before their metadata is removed.
In-flight detail/library responses are fenced by a local cache revision; open
views also respond to permission invalidation. Ordinary transport/5xx failures
retain the last authorized offline cache. Local originals, captures and drafts
are preserved throughout.

A successful delta invalidates changed details and removes tombstoned details
from offline search. A replacement snapshot discards old detail projections,
whose source permissions cannot be certified by a timeline summary alone.

## Restore boundary and limits

Successful archive import rotates synchronization generation inside the restore
transaction, invalidates cursor handles, and preserves the stable installation ID.
A failed restore rolls back this rotation along with imported data. This prevents
an old client checkpoint from being treated as a current continuation.

This change does **not** establish a complete recovery policy for copying an older
raw database over an installation or reconciling grants revoked after an old ZIP
was created. That coordinated recovery work remains tracked in the 1.0 execution
state. It must not be inferred from passing incremental-sync tests.

An offline device cannot learn a new server revocation until it reconnects. The
application can withdraw its managed cache after learning of that revocation;
it cannot recall files a user has already exported or copied outside the app.

## Automated evidence

- `tests/integration/incremental-sync.test.ts`: authenticated HTTP, opaque cursor
  binding, authorized tombstones, transaction rollback, second SQLite connection,
  generation rotation and retention recovery.
- `tests/integration/snapshot-sync-access.test.ts`: final-response revocation,
  disabled account metadata denial, and unknown-time age suppression.
- `mobile/tests/sync-cache.test.ts`: real SQLite atomic staging, incremental
  preservation, interrupted pages, revoked offline search, owned capture retention.
- `mobile/tests/memory-cache.test.ts` and `library-cache.test.ts`: rendered cache
  withdrawal, late responses, account switching and transient-error behavior.
- `mobile/tests/capture-production.http.ts`, launched by production Playwright:
  actual native storage/sync/fetch against Next HTTP, unchanged delta, editing,
  sharing withdrawal and offline search. Platform widgets/filesystem are test
  adapters; this is not physical iOS/Android acceptance evidence.
