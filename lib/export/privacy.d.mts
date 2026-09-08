export type ArchivePrincipal = { id: string; name: string };
export type ArchivePrivacyRow = { id: string; visibility: "family" | "members" | "private"; owner: string | null; readers: string[] };
export type ArchivePrivacy = { version: 1; principals: ArchivePrincipal[]; events: ArchivePrivacyRow[]; assets: Omit<ArchivePrivacyRow, "readers">[]; drafts: ArchivePrivacyRow[]; books: { id: string; owner: string | null }[]; imports: { id: string; owner: string | null }[]; reviewAssets: { inboxItemId: string; assetId: string }[] };
export function validateArchivePrivacy(raw: unknown, refs: { events: Set<string>; assets: Set<string>; drafts: Set<string>; books: Set<string>; imports: Set<string>; reviewAssets: Set<string> }): ArchivePrivacy;
