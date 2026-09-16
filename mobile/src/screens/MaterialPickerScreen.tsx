import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { FlatList, Image, Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MonthPicker } from "../components/MonthPicker";
import { Text } from "../components/typography";
import { useConfirmSheet } from "../components/GlassSheet";
import { Button, Chip } from "../components/ui";
import { fetchBookMaterials } from "../api/client";
import { listLocalDrafts } from "../drafts/store";
import { formatOccurredDateLabel } from "../utils/occurred-precision";
import { savedDraftContent } from "../drafts/reading";
import {
  getLocalAlbum,
  materialKey,
  localMaterialDetails,
} from "../collections/local";
import { useAppActions, useAppData } from "../state/AppContext";
import { useColorTheme, useSharedStyles } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import { useWorkSession } from "../worksession/useSession";
import { toggleWorkSelection } from "../worksession/store";
import {
  remotePresentation,
  type MaterialPresentation,
} from "../worksession/materials";
import { commitWorkSession } from "../worksession/commit";

export function MaterialPickerScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "MaterialPicker">) {
  const s = useSharedStyles(),
    { colors } = useColorTheme(),
    insets = useSafeAreaInsets();
  const { credentials, online, events, family } = useAppData();
  const { runSync } = useAppActions();
  const confirm = useConfirmSheet();
  const { session, update, error, setError, valid, flush } = useWorkSession(
    route.params.scope,
    route.params.sessionId,
  );
  const [rows, setRows] = useState<MaterialPresentation[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    list = useRef<FlatList<MaterialPresentation>>(null),
    restored = useRef(false);
  const positions = useRef(session?.positions);
  useEffect(() => {
    positions.current = session?.positions;
  }, [session?.positions]);
  const pageCount = useRef(1);
  const source = session?.source,
    filterMonth = session?.month ?? "",
    scope = session?.scope,
    isBook = session?.target.kind === "book";
  const load = useCallback(
    async (next = "") => {
      if (!source || !scope) return;
      const gen = ++generation.current;
      setLoading(true);
      try {
        let entries: MaterialPresentation[] = [],
          after: string | null = null;
        if (
          source === "localDraft" ||
          (!isBook && source === "memory" && !next)
        ) {
          const drafts = [
            ...(await listLocalDrafts(scope)),
            ...(scope !== "local" ? await listLocalDrafts("local") : []),
          ].filter((d) => {
            const content = savedDraftContent(d);
            return (
              content &&
              (!filterMonth || content.occurredAt?.startsWith(filterMonth))
            );
          });
          entries = (
            await Promise.all(
              drafts.map(async (d) => {
                const ref = {
                    kind: "localDraft" as const,
                    scope: d.scope,
                    id: d.id,
                  },
                  row = await localMaterialDetails(ref, d);
                return row
                  ? {
                      ref,
                      title: row.title,
                      date: row.occurredAt
                        ? formatOccurredDateLabel(
                            row.occurredAtPrecision,
                            row.occurredAt,
                            family?.timezone ?? "UTC",
                          )
                        : null,
                      uri: row.uri,
                      available: true,
                    }
                  : null;
              }),
            )
          ).filter((r): r is NonNullable<typeof r> => !!r);
        }
        if (source !== "localDraft" && credentials && online !== false) {
          const page = await fetchBookMaterials(
            credentials,
            source,
            "personal",
            next,
            filterMonth,
          );
          entries.push(
            ...page.entries.map((i) =>
              remotePresentation(i, scope, credentials),
            ),
          );
          after = page.nextCursor;
          if (!next) {
            pageCount.current = 1;
            const wanted =
              positions.current?.[`${source}:${filterMonth}`]?.pages ?? 1;
            while (after && pageCount.current < wanted) {
              const extra = await fetchBookMaterials(
                credentials,
                source,
                "personal",
                after,
                filterMonth,
              );
              entries.push(
                ...extra.entries.map((i) =>
                  remotePresentation(i, scope, credentials),
                ),
              );
              after = extra.nextCursor;
              pageCount.current++;
            }
          } else pageCount.current++;
        } else if (isBook && source !== "localDraft")
          throw new Error("成长册选材需要连接家庭服务器。");
        if (gen !== generation.current) return;
        setRows((old) => (next ? [...old, ...entries] : entries));
        setCursor(after);
        setError("");
      } catch (e) {
        if (gen === generation.current) setError((e as Error).message);
      } finally {
        if (gen === generation.current) setLoading(false);
      }
    },
    [source, scope, filterMonth, credentials, online, setError, isBook, family],
  );
  useFocusEffect(
    useCallback(() => {
      restored.current = false;
      setRows([]);
      setCursor(null);
      void load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );

  async function done() {
    if (!session || busy) return;
    setBusy(true);
    try {
      await flush();
      if (session.target.mode === "append") {
        const localSources = session.selected.some(
          (r) => r.kind === "localDraft",
        );
        const linked =
          session.target.kind === "collection" ||
          (session.target.kind === "localAlbum" &&
            !!(await getLocalAlbum(session.scope, session.target.id))
              ?.remoteId);
        if (
          linked &&
          localSources &&
          !(await confirm({
            title: "上传这些记录并加入相册",
            message: `将 ${session.selected.filter((r) => r.kind === "localDraft").length} 条本机记录及原件上传到「${family?.name ?? "已连接的家庭"}」（${credentials?.serverUrl ?? ""}）。原记录的读者范围保持不变；离线时先保留待办。`,
            confirmLabel: "同意上传并加入",
            cancelLabel: "保留选择",
          }))
        )
          return;
        await commitWorkSession(session, credentials, {
          authorizeSources: linked && localSources,
        });
        if (linked && credentials && online !== false) void runSync();
        navigation.goBack();
      } else navigation.navigate("WorkPreview", route.params);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!valid)
    return (
      <View style={s.empty}>
        <Text style={s.body}>账号或家庭已变化，请重新选择。</Text>
      </View>
    );
  const counts = new Map<string, number>();
  for (const event of events ?? []) {
    const month = event.occurredAt.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  const savePosition = (offset: number) =>
    void update((r) => ({
      ...r,
      positions: {
        ...r.positions,
        [`${source}:${filterMonth}`]: { offset, pages: pageCount.current },
      },
    }));
  return (
    <View style={s.screen}>
      <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 10 }}>
        <Text style={s.title}>选择内容</Text>
        <Text style={s.body}>已选 {session?.selected.length ?? 0} 条</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {!isBook ? (
            <Chip
              label="本机"
              selected={source === "localDraft"}
              onPress={() =>
                void update((r) => ({ ...r, source: "localDraft" }))
              }
            />
          ) : null}
          {scope !== "local" ? (
            <Chip
              label={isBook ? "家庭记录" : "全部记录"}
              selected={source === "memory"}
              onPress={() => void update((r) => ({ ...r, source: "memory" }))}
            />
          ) : null}
          {isBook && scope !== "local" ? (
            <Chip
              label="相册"
              selected={source === "collection"}
              onPress={() =>
                void update((r) => ({ ...r, source: "collection" }))
              }
            />
          ) : null}
        </View>
        {source !== "collection" ? (
          <MonthPicker
            value={filterMonth}
            currentMonth={new Date().toISOString().slice(0, 7)}
            counts={counts}
            allowAll
            onChange={(month) => void update((r) => ({ ...r, month }))}
          />
        ) : null}
      </View>
      <FlatList
        ref={list}
        testID="material-picker-list"
        data={rows}
        onScrollEndDrag={(event) =>
          savePosition(event.nativeEvent.contentOffset.y)
        }
        onMomentumScrollEnd={(event) =>
          savePosition(event.nativeEvent.contentOffset.y)
        }
        onContentSizeChange={() => {
          if (!restored.current && rows.length) {
            restored.current = true;
            list.current?.scrollToOffset({
              offset:
                positions.current?.[`${source}:${filterMonth}`]?.offset ?? 0,
              animated: false,
            });
          }
        }}
        keyExtractor={(i) => materialKey(i.ref)}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const checked = !!session?.selected.some(
            (r) => materialKey(r) === materialKey(item.ref),
          );
          return (
            <Pressable
              testID={`material-row-${item.ref.id}`}
              accessibilityRole="checkbox"
              accessibilityLabel={item.title}
              accessibilityState={{ checked }}
              onPress={() => {
                void update((r) => toggleWorkSelection(r, item.ref)).catch(
                  (e) => setError(e.message),
                );
              }}
              style={{
                flexDirection: "row",
                gap: 14,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: checked ? colors.coral : colors.muted,
                  fontSize: 24,
                }}
              >
                {checked ? "●" : "○"}
              </Text>
              {item.uri ? (
                <Image
                  source={{
                    uri: item.uri,
                    ...(item.remote && credentials
                      ? {
                          headers: {
                            Authorization: `Bearer ${credentials.token}`,
                          },
                        }
                      : {}),
                  }}
                  resizeMode="cover"
                  style={{ width: 76, height: 86, borderRadius: 8 }}
                />
              ) : null}
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={s.cardTitle} numberOfLines={3}>
                  {item.title}
                </Text>
                {item.date ? <Text style={s.body}>{item.date}</Text> : null}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={s.body}>
            {loading ? "正在读取…" : "这个月份还没有可选内容。"}
          </Text>
        }
        ListFooterComponent={
          cursor ? (
            <Button
              title={loading ? "正在读取…" : "更多记录"}
              disabled={loading}
              onPress={() => void load(cursor)}
            />
          ) : null
        }
      />
      <View
        style={{
          padding: 16,
          paddingBottom: Math.max(insets.bottom, 16),
          backgroundColor: colors.paper,
          borderTopWidth: 1,
          borderTopColor: colors.line,
        }}
      >
        <Button
          testID="material-picker-done"
          variant="primary"
          title={
            busy
              ? "正在保存…"
              : session?.target.mode === "append"
                ? "加入此相册"
                : `预览 ${session?.selected.length ?? 0} 条`
          }
          disabled={busy || !session?.selected.length}
          onPress={() => void done()}
        />
      </View>
    </View>
  );
}
