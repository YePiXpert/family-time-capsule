/** A bounded two-way merge: fetch the exhausted stream before choosing the next head. */
export type CoverEntry = {
  kind: "book" | "collection";
  id: string;
  title: string;
  updatedAt: string;
  coverAssetId: string | null;
  count?: number;
  revision: number;
  downloadKey?: string;
  localCoverUri?: string;
};
type Page = { entries: CoverEntry[]; nextCursor: string | null };
export function createCoverPager(
  book: (cursor: string) => Promise<Page>,
  album: (cursor: string) => Promise<Page>,
) {
  const streams = [
    {
      fetch: book,
      buffer: [] as CoverEntry[],
      cursor: "" as string | null,
      started: false,
    },
    {
      fetch: album,
      buffer: [] as CoverEntry[],
      cursor: "" as string | null,
      started: false,
    },
  ];
  const compare = (a: CoverEntry, b: CoverEntry) =>
    b.updatedAt.localeCompare(a.updatedAt) ||
    b.id.localeCompare(a.id) ||
    a.kind.localeCompare(b.kind);
  const fill = async (s: (typeof streams)[number]) => {
    while (!s.buffer.length && (!s.started || s.cursor !== null)) {
      const page = await s.fetch(s.cursor ?? "");
      s.buffer = page.entries;
      s.cursor = page.nextCursor;
      s.started = true;
    }
  };
  return {
    async next(limit = 30) {
      const result: CoverEntry[] = [];
      while (result.length < limit) {
        await Promise.all(streams.map(fill));
        const available = streams.filter((s) => s.buffer.length);
        if (!available.length) break;
        available.sort((a, b) => compare(a.buffer[0]!, b.buffer[0]!));
        result.push(available[0]!.buffer.shift()!);
      }
      return result;
    },
    hasMore() {
      return streams.some(
        (s) => s.buffer.length || !s.started || s.cursor !== null,
      );
    },
  };
}
