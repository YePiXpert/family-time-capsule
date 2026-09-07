/** Pure validator shared with the standalone export verifier. Operational file
 * cleanup paths and account authority can never enter a portable archive. */
export function parseAssetDeletions(value, liveAssetIds) {
  if (!Array.isArray(value)) throw new Error("invalid asset deletions");
  const ids = new Set();
  return value.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join() !== "assetId,deletedAt,sha256" ||
        typeof row.assetId !== "string" || !/^[a-z0-9-]{36}$/i.test(row.assetId) || ids.has(row.assetId) || liveAssetIds.has(row.assetId) ||
        typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256) ||
        typeof row.deletedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(row.deletedAt) || !Number.isFinite(Date.parse(row.deletedAt))) throw new Error("invalid asset deletions");
    ids.add(row.assetId);
    return { assetId: row.assetId, sha256: row.sha256, deletedAt: row.deletedAt };
  });
}
