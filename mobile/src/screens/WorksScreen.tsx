import { useCallback, useRef, useState } from "react";
import { FlatList, Image, Pressable, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { AppNavigation } from "../navigation/types";
import { Text } from "../components/typography";
import { Button, Chip } from "../components/ui";
import { useAppData } from "../state/AppContext";
import { useColorTheme, useSharedStyles } from "../theme";
import {
  useJournalContentInset,
  useJournalTitleInset,
} from "../navigation/dock-metrics";
import { fetchBooks, fetchCollections } from "../api/client";
import { draftReadingScope } from "../drafts/reading";
import {
  listLocalAlbums,
  localMaterialDetails,
  type LocalAlbum,
} from "../collections/local";
import {
  createWorkSession,
  listWorkSessions,
  type WorkSession,
} from "../worksession/store";
import { createCoverPager, type CoverEntry } from "../collections/shelf";
import { loadReadingShelf, downloadedCoverUri } from "../reading/shelf";
import { readingDownloads } from "../reading/native";
type Cover =
  | CoverEntry
  | {
      kind: "localAlbum";
      id: string;
      title: string;
      updatedAt: string;
      scope: string;
      count: number;
      localCoverUri?: string | null;
      pending: boolean;
      remoteId?: string | null;
    };
export function WorksScreen() {
  const navigation = useNavigation<AppNavigation>(),
    s = useSharedStyles(),
    { colors } = useColorTheme();
  const bottom = useJournalContentInset(),
    top = useJournalTitleInset();
  const { credentials, userId, viewer, family, online } = useAppData(),
    scope = draftReadingScope(credentials, userId, viewer?.id, family?.id);
  const identity = JSON.stringify([scope, credentials?.token, online]);
  const [state, setState] = useState<{ identity: string; rows: Cover[] }>({
      identity: "",
      rows: [],
    }),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [sessions, setSessions] = useState<{
      identity: string;
      rows: WorkSession[];
    }>({ identity: "", rows: [] });
  const pager = useRef<ReturnType<typeof createCoverPager> | null>(null),
    generation = useRef(0);
  const toLocal = useCallback(
    async (a: LocalAlbum): Promise<Cover> => {
      const item = a.items.find((i) => i.id === a.coverItemId) ?? a.items[0];
      const detail =
        item &&
        item.ref.kind === "localDraft" &&
        (item.ref.scope === "local" || item.ref.scope === scope)
          ? await localMaterialDetails(item.ref)
          : null;
      return {
        kind: "localAlbum",
        id: a.id,
        title: a.title,
        updatedAt: a.updatedAt,
        scope: a.scope,
        remoteId: a.remoteId,
        count: a.items.length,
        localCoverUri: detail?.uri,
        pending: !!a.pending,
      };
    },
    [scope],
  );
  const load = useCallback(async () => {
    const gen = ++generation.current;
    setState({ identity, rows: [] });
    setLoading(true);
    setError("");
    setMore(false);
    pager.current = null;
    if (!scope) {
      setLoading(false);
      return;
    }
    try {
      const locals = [
        ...(await listLocalAlbums("local")),
        ...(scope !== "local" ? await listLocalAlbums(scope) : []),
      ];
      const unfinished = [
        ...(await listWorkSessions("local")),
        ...(scope !== "local" ? await listWorkSessions(scope) : []),
      ];
      if (gen === generation.current)
        setSessions({ identity, rows: unfinished });
      const localRows = await Promise.all(
        locals.filter((a) => !a.remoteId || !!a.pending).map(toLocal),
      );
      if (gen !== generation.current) return;
      setState({ identity, rows: localRows });
      if (!credentials || scope === "local") return;
      const common = {
        credentials,
        connected: online,
        deleted: false,
        familyId: family?.id,
        userId: userId ?? viewer?.id,
      };
      const [books, albums] = await Promise.all([
        loadReadingShelf({
          ...common,
          kind: "book",
          fetchPage: () => fetchBooks(credentials),
        }),
        loadReadingShelf({
          ...common,
          kind: "collection",
          fetchPage: () => fetchCollections(credentials),
        }),
      ]);
      if (gen !== generation.current) return;
      const mapBooks = (page: NonNullable<typeof books.page>) => ({
        entries: page.entries.map((i) => ({
          kind: "book" as const,
          id: i.id,
          title: i.title,
          updatedAt: i.updatedAt,
          coverAssetId: i.coverAssetId,
          revision: i.revision,
        })),
        nextCursor: page.nextCursor,
      });
      const mapAlbums = (page: NonNullable<typeof albums.page>) => ({
        entries: page.entries.map((i) => ({
          kind: "collection" as const,
          id: i.id,
          title: i.title,
          updatedAt: i.updatedAt ?? "",
          coverAssetId: i.coverAssetId,
          revision: i.revision,
          count: i.count,
        })),
        nextCursor: page.nextCursor,
      });
      let remote: CoverEntry[];
      if (books.offline || albums.offline) {
        remote = [...books.downloads, ...albums.downloads].map((e) => ({
          kind: e.kind,
          id: e.id,
          title: e.manifest.title,
          updatedAt: new Date(e.updatedAt).toISOString(),
          coverAssetId: null,
          revision: e.manifest.revision,
          downloadKey: e.key,
          localCoverUri: downloadedCoverUri(e),
        }));
      } else {
        let firstBook = true,
          firstAlbum = true;
        const p = createCoverPager(
          async (c) => {
            const page = firstBook
              ? ((firstBook = false), books.page!)
              : await fetchBooks(credentials, false, c);
            return mapBooks(page);
          },
          async (c) => {
            const page = firstAlbum
              ? ((firstAlbum = false), albums.page!)
              : await fetchCollections(credentials, false, c);
            return mapAlbums(page);
          },
        );
        pager.current = p;
        remote = await p.next();
        setMore(p.hasMore());
      }
      if (gen === generation.current)
        setState({ identity, rows: [...localRows, ...remote] });
    } catch (e) {
      if (gen === generation.current) setError((e as Error).message);
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [scope, identity, credentials, online, family, userId, viewer, toLocal]);
  useFocusEffect(
    useCallback(() => {
      void load();
      const unsubscribe = readingDownloads.subscribe((key) => {
        if (key)
          setState((old) => ({
            ...old,
            rows: old.rows.filter(
              (r) => !("downloadKey" in r && r.downloadKey === key),
            ),
          }));
      });
      return () => {
        generation.current++;
        unsubscribe();
      };
    }, [load]),
  );
  async function next() {
    if (!pager.current || loading) return;
    const gen = generation.current;
    setLoading(true);
    try {
      const rows = await pager.current.next();
      if (gen === generation.current) {
        setState((old) => ({ ...old, rows: [...old.rows, ...rows] }));
        setMore(pager.current.hasMore());
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }
  async function create(kind: "album" | "book") {
    if (!scope) return;
    try {
      const session = await createWorkSession(scope, { mode: "create", kind });
      navigation.navigate("MaterialPicker", { scope, sessionId: session.id });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const rows = (state.identity === identity ? state.rows : [])
    .filter((r) => !(r.kind === "localAlbum" && r.remoteId))
    .filter(
      (r) =>
        filter === "all" ||
        (filter === "book" ? r.kind === "book" : r.kind !== "book"),
    )
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
    );
  function open(item: Cover) {
    if (item.kind === "localAlbum")
      navigation.navigate("LocalAlbum", { id: item.id, scope: item.scope });
    else if (item.downloadKey)
      navigation.navigate("OfflineReading", { key: item.downloadKey });
    else
      navigation.navigate(
        item.kind === "book" ? "BookDetail" : "CollectionDetail",
        { id: item.id },
      );
  }
  return (
    <View style={s.screen}>
      <FlatList
        data={rows}
        numColumns={2}
        keyExtractor={(r) => `${r.kind}:${r.id}`}
        contentContainerStyle={[
          s.content,
          { paddingTop: top, paddingBottom: bottom },
        ]}
        columnWrapperStyle={{ gap: 16 }}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 20 }}>
            <Text style={s.title}>相册</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button
                title="新建相册"
                variant="primary"
                full={false}
                onPress={() => void create("album")}
              />
              <Button
                title="制作成长册"
                full={false}
                disabled={
                  !credentials ||
                  !scope ||
                  scope === "local" ||
                  online === false
                }
                onPress={() => void create("book")}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                { key: "all", label: "全部" },
                { key: "album", label: "相册" },
                { key: "book", label: "成长册" },
              ].map((f) => (
                <Chip
                  key={f.key}
                  label={f.label}
                  selected={filter === f.key}
                  onPress={() => setFilter(f.key)}
                />
              ))}
            </View>
            {error ? (
              <>
                <Text style={s.error}>{error}</Text>
                <Button title="重新读取" onPress={() => void load()} />
              </>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const uri =
            item.localCoverUri ??
            ("coverAssetId" in item && item.coverAssetId && credentials
              ? `${credentials.serverUrl}/api/media/${encodeURIComponent(item.coverAssetId)}`
              : null);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={() => open(item)}
              style={{ flex: 1, maxWidth: "48%", paddingBottom: 24, gap: 10 }}
            >
              {uri ? (
                <Image
                  source={{
                    uri,
                    ...(!item.localCoverUri && credentials
                      ? {
                          headers: {
                            Authorization: `Bearer ${credentials.token}`,
                          },
                        }
                      : {}),
                  }}
                  resizeMode="cover"
                  style={{ width: "100%", aspectRatio: 0.78, borderRadius: 10 }}
                />
              ) : (
                <View
                  style={{
                    aspectRatio: 0.78,
                    borderRadius: 10,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.line,
                    padding: 20,
                    justifyContent: "center",
                  }}
                >
                  <Text style={s.cardTitle}>{item.title}</Text>
                </View>
              )}
              <Text style={s.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={s.body}>
                {item.kind === "book"
                  ? "成长册"
                  : item.kind === "localAlbum"
                    ? item.pending
                      ? "待同步"
                      : "仅本机"
                    : "相册"}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={s.body}>
            {loading
              ? "正在打开…"
              : "把想常常翻看的记录放在一起。新建相册后，随时可以离线添加本机记录。"}
          </Text>
        }
        ListFooterComponent={
          <View style={{ gap: 12 }}>
            {(sessions.identity === identity ? sessions.rows : []).map(
              (session) => (
                <Button
                  key={session.id}
                  title={`继续${session.target.kind === "book" ? "制作成长册" : "整理相册"} · ${session.title || `${session.selected.length} 条记录`}`}
                  onPress={() =>
                    navigation.navigate("WorkPreview", {
                      scope: session.scope,
                      sessionId: session.id,
                    })
                  }
                />
              ),
            )}
            {more ? (
              <Button
                title={loading ? "正在读取…" : "更多相册"}
                disabled={loading}
                onPress={() => void next()}
              />
            ) : null}
            {(state.identity === identity ? state.rows : [])
              .filter(
                (r): r is Extract<Cover, { kind: "localAlbum" }> =>
                  r.kind === "localAlbum" && !!r.remoteId && r.pending,
              )
              .map((r) => (
                <Button
                  key={r.id}
                  title="处理待加入相册的记录"
                  onPress={() =>
                    navigation.navigate("LocalAlbum", {
                      id: r.id,
                      scope: r.scope,
                    })
                  }
                />
              ))}
            <Button
              title="已下载内容"
              variant="ghost"
              onPress={() => navigation.navigate("ReadingDownloads")}
            />
          </View>
        }
      />
    </View>
  );
}
