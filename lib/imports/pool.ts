/** Browser-safe bounded scheduler. One failure is returned, never cancels siblings. */
export async function runBoundedImportPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<Array<PromiseSettledResult<void>>> {
  const width = Math.max(1, Math.min(Math.floor(concurrency), 10));
  const results: Array<PromiseSettledResult<void>> = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
        results[index] = { status: "fulfilled", value: undefined };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, run));
  return results;
}
