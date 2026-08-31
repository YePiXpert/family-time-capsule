# Family permissions

Family Time Capsule is invitation-only. A login account (`User`) is an access
principal; a real family member (`Person`) is an archive subject or narrator.
They remain separate, and a Person never needs an account.

## Roles

| Capability | admin | editor | contributor | viewer |
|---|---:|---:|---:|---:|
| View content allowed by row visibility | yes | yes | yes | yes |
| Capture text/media into Inbox | yes | yes | yes | no |
| Review, merge, confirm, or discard Inbox | yes | yes | no | no |
| Create/edit MemoryEvents | yes | yes | no | no |
| Draft/edit/publish Stories | yes | yes | no | no |
| Add a Contribution | yes | yes | own Person only | no |
| Create/manage capsules | yes | yes | no | no |
| Manage People, accounts, roles, and invites | yes | no | no | no |
| Configure external AI | yes | no | no | no |
| Review AI suggestions | yes | yes | no | no |
| Full disaster export, restore, and backup | yes | no | no | no |
| Read audit history | yes | no | no | no |

These decisions are enforced by the shared policy in `lib/authz/policy.ts` and
server-side context builders. Hiding a control is only presentation; API
routes, Server Actions, media access, search, Stories, capsules, workers, and
exports must independently authorize the operation.

Accounts are disabled rather than deleted. This retains attribution and avoids
letting account lifecycle operations cascade into irreplaceable family media.
Every request rejects a disabled account even if an older session cookie still
exists.

## Contribution visibility

Visibility applies to the Contribution row and its text/audio/transcript. The
viewer must first be an enabled account in the same family.

| Value | Normal UI, search, and Story-source access |
|---|---|
| `private` | Only the account linked to the author Person |
| `parents` | The author and accounts linked to a Person explicitly marked `isGuardian` |
| `family` | Any enabled account in the same family |
| `child_later` | The author and guardians until unlock; all enabled family accounts after unlock |

An `admin` is not silently treated as a parent and does not gain normal access
to somebody else's `private` Contribution. Guardian status is an explicit
Person attribute; the application never guesses it from free-form labels such
as “妈妈” or “爸爸”. Admin-only disaster archives include every durable row so
private data is recoverable, but that operational bypass is not reused by UI,
search, AI, or Story generation.

`child_later` is evaluated against the MemoryEvent's child and the family's
explicit policy: the configured unlock age (18 by default), or a recorded
manual unlock time. A missing birth date never causes an automatic unlock.
Manual unlock is admin-only and audited.

## Authorship and editing

A Contribution preserves one Person's voice. An enabled linked author with
contribution permission may edit their own words. Role alone does not transfer
authorship: an admin/editor cannot rewrite another Person's Contribution.
Admins and editors may create a faithful record on behalf of a Person who has
no account; contributors may submit only as their linked Person. Moderation,
trash, and purge are separate audited operations and never masquerade as an
author edit.

## Invitations

There is no public signup. An admin creates a family-scoped invitation with a
specific role and optional Person/email binding. The displayed token is random
and high entropy; only its SHA-256 hash is stored. Invitations expire, can be
revoked, are single-use, and use an expiring atomic claim so concurrent or
crashed acceptance cannot create two accounts. Acceptance creates a credential
through Better Auth's password hasher; plaintext passwords and raw tokens are
never logged, stored, or exported.

Role changes, invitation creation/revocation/use, account disablement, manual
`child_later` unlock, export, restore, and backup operations are written to the
family-scoped audit log without private Contribution bodies or secrets.
