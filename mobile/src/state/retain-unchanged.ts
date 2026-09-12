/**
 * SQLite reads return new JSON objects even when an archive has not changed.
 * Keep equal values (and rows with the same id after an insertion) so a sync
 * notification does not invalidate every visible card or restart a reader.
 * Inputs are the archive's JSON snapshots, never mutable native objects.
 */
export function retainUnchanged<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (previous === null || next === null || typeof previous !== "object" || typeof next !== "object") return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    const byId = new Map(previous.flatMap(value => hasId(value) ? [[value.id, value] as const] : []));
    let unchanged = previous.length === next.length;
    const shared = next.map((value, index) => {
      const before = hasId(value) ? byId.get(value.id) : previous[index];
      const retained = retainUnchanged(before, value);
      if (retained !== previous[index]) unchanged = false;
      return retained;
    });
    return (unchanged ? previous : shared) as T;
  }
  if (Array.isArray(previous) || Array.isArray(next)) return next;
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let unchanged = keys.length === Object.keys(before).length;
  const shared: Record<string, unknown> = {};
  for (const key of keys) {
    shared[key] = retainUnchanged(before[key], after[key]);
    if (!Object.hasOwn(before, key) || shared[key] !== before[key]) unchanged = false;
  }
  return (unchanged ? previous : shared) as T;
}

function hasId(value: unknown): value is { id: string } {
  return value !== null && typeof value === "object" && "id" in value && typeof value.id === "string";
}
