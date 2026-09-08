const kinds = new Set(["fact", "contribution", "transcript", "memory_event"]);

/** Null means the historical model input cannot be proven from the archive. */
export function validateStoryInputSources(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 4096) throw new Error("invalid_story_input_sources");
  const seen = new Set();
  return value.map(source => {
    if (!source || typeof source !== "object" || Array.isArray(source) ||
      Object.keys(source).sort().join(",") !== "sourceId,sourceType" || !kinds.has(source.sourceType) ||
      typeof source.sourceId !== "string" || !/^[\w-]{1,128}$/u.test(source.sourceId)) throw new Error("invalid_story_input_sources");
    const key = `${source.sourceType}:${source.sourceId}`;
    if (seen.has(key)) throw new Error("invalid_story_input_sources");
    seen.add(key);
    return { sourceType: source.sourceType, sourceId: source.sourceId };
  });
}

export function readStoryInputSources(row) {
  try { return validateStoryInputSources(JSON.parse(row.inputSourcesJson ?? "null")); }
  catch { return null; }
}
