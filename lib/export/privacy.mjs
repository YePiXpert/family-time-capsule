/** Shared by the restore preflight and standalone archive verifier. */
export function validateArchivePrivacy(raw, refs) {
  const fail = () => { throw new Error("invalid_archive_privacy"); };
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const exact = (value, keys) => object(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
  const id = value => typeof value === "string" && /^[\w-]{1,128}$/u.test(value);
  if (!exact(raw, ["version", "principals", "events", "assets", "drafts", "books", "imports", "reviewAssets"]) || raw.version !== 1 || !Array.isArray(raw.principals)) fail();
  const principals = new Set();
  for (const p of raw.principals) {
    if (!exact(p, ["id", "name"]) || !id(p.id) || principals.has(p.id) || typeof p.name !== "string" || p.name.length > 200) fail();
    principals.add(p.id);
  }
  const validateRows = (rows, expected, kind) => {
    if (!Array.isArray(rows)) fail();
    const seen = new Set();
    for (const r of rows) {
      const hasReaders = kind !== "assets";
      if (!exact(r, ["id", "visibility", "owner", ...(hasReaders ? ["readers"] : [])]) || !expected.has(r.id) || seen.has(r.id)) fail();
      seen.add(r.id);
      if (!(hasReaders ? ["family", "members", "private"] : ["family", "private"]).includes(r.visibility)) fail();
      if (r.owner === null ? kind !== "events" || r.visibility !== "family" : !principals.has(r.owner)) fail();
      if (hasReaders && (!Array.isArray(r.readers) || r.readers.length > 20 || new Set(r.readers).size !== r.readers.length || r.readers.some(p => !principals.has(p)) || (r.visibility !== "members" && r.readers.length))) fail();
    }
    if (seen.size !== expected.size) fail();
  };
  for (const kind of ["events", "assets", "drafts"]) validateRows(raw[kind], refs[kind], kind);
  for (const kind of ["books", "imports"]) {
    if (!Array.isArray(raw[kind])) fail();
    const seen = new Set();
    for (const r of raw[kind]) {
      if (!exact(r, ["id", "owner"]) || !refs[kind].has(r.id) || seen.has(r.id) || (r.owner !== null && !principals.has(r.owner))) fail();
      seen.add(r.id);
    }
    if (seen.size !== refs[kind].size) fail();
  }
  if (!Array.isArray(raw.reviewAssets)) fail();
  const receipts = new Set();
  for (const r of raw.reviewAssets) {
    const key = `${r?.inboxItemId}:${r?.assetId}`;
    if (!exact(r, ["inboxItemId", "assetId"]) || !refs.reviewAssets.has(key) || receipts.has(key)) fail();
    receipts.add(key);
  }
  return raw;
}
