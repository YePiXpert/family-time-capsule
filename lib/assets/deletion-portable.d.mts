export type ArchivedAssetDeletion = { assetId: string; sha256: string; deletedAt: string };
export function parseAssetDeletions(value: unknown, liveAssetIds: Set<string>): ArchivedAssetDeletion[];
