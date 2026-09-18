import { useEffect, useRef, useState } from "react";
import {
  usePreventRemove,
  type NavigationAction,
} from "@react-navigation/native";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useLibrary, useStore } from "./context";
import { beginSelection, newId, now } from "./services";
import { finishSelection, monthKey, sortedRecords } from "./model";
import type { Props } from "./navigation";
import {
  BottomBar,
  Button,
  ErrorText,
  Field,
  Page,
  Text,
  messageOf,
  useStyles,
} from "./ui";
import { RecordCard } from "./Home";
import { NoteCard } from "./NoteCard";
import { Photo } from "./Media";
export function AlbumScreen({ route, navigation }: Props<"Album">) {
  const store = useStore(),
    state = useLibrary(),
    s = useStyles();
  const album = state.albums[route.params.id];
  const [organize, setOrganize] = useState(false),
    [cover, setCover] = useState(false),
    [name, setName] = useState(album?.name ?? ""),
    [error, setError] = useState("");
  const action = (fn: Parameters<typeof store.change>[0]) => {
    void store.change(fn).catch((e) => setError(messageOf(e)));
  };
  if (!album)
    return (
      <Page>
        <Text>这个相册已删除。</Text>
      </Page>
    );
  const photos = [
    ...new Set(
      album.items.flatMap((i) => state.records[i.recordId]?.mediaIds ?? []),
    ),
  ].filter((id) => state.media[id]?.kind === "image");
  const coverMedia =
    state.media[album.coverId ?? ""] ?? state.media[photos[0] ?? ""];
  return (
    <Page scroll={false}>
      <FlatList
        testID="album-reading"
        data={album.items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            {coverMedia && (
              <Photo media={coverMedia} preview label="相册封面" />
            )}
            <Text style={s.title}>{album.name}</Text>
            <Text style={s.muted}>{album.items.length} 段记录</Text>
            <NoteCard
              heading="这本相册的话"
              placeholder="写几句这本相册想说的话…"
              emptyHint="翻完这些记录，留几句想对她说的话。"
              note={album.note ?? ""}
              testPrefix="album-note"
              onSave={async (value) => {
                await store.change((s) => {
                  const target = s.albums[album.id];
                  if (!target) throw new Error("相册已删除。");
                  if (value) target.note = value;
                  else delete target.note;
                  target.updatedAt = now();
                });
              }}
            />
            <View style={s.row}>
              <Button
                title="添加记录"
                testID="album-add"
                primary
                onPress={() => {
                  void beginSelection(store, album.id)
                    .then((sessionId) =>
                      navigation.navigate("Picker", { sessionId }),
                    )
                    .catch((e) => setError(messageOf(e)));
                }}
              />
              <Button title="换封面" onPress={() => setCover(!cover)} />
              <Button
                title={organize ? "完成整理" : "整理"}
                onPress={() => setOrganize(!organize)}
              />
            </View>
            {cover && (
              <View style={{ gap: 12 }}>
                {photos.length === 0 && (
                  <Text>先添加含照片的记录，就能选择封面。</Text>
                )}
                {photos.map((id) => (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityLabel="选为相册封面"
                    onPress={() => {
                      action((s) => {
                        s.albums[album.id]!.coverId = id;
                        s.albums[album.id]!.updatedAt = now();
                      });
                      setCover(false);
                    }}
                  >
                    <Photo media={state.media[id]} preview />
                  </Pressable>
                ))}
              </View>
            )}
            {organize && (
              <View style={s.section}>
                <Field label="相册名称" value={name} onChangeText={setName} />
                <Button
                  title="保存名称"
                  onPress={() =>
                    action((s) => {
                      s.albums[album.id]!.name = name.trim() || "新相册";
                      s.albums[album.id]!.updatedAt = now();
                    })
                  }
                />
                <Button
                  title="删除相册"
                  onPress={() =>
                    Alert.alert("删除这个相册？", "其中的原记录会保留。", [
                      { text: "取消", style: "cancel" },
                      {
                        text: "删除相册",
                        style: "destructive",
                        onPress: () => {
                          void store
                            .change((s) => {
                              delete s.albums[album.id];
                              for (const [id, q] of Object.entries(
                                s.selections,
                              ))
                                if (q.albumId === album.id)
                                  delete s.selections[id];
                            })
                            .then(() => navigation.goBack())
                            .catch((e) => setError(messageOf(e)));
                        },
                      },
                    ])
                  }
                />
              </View>
            )}
            <ErrorText message={error} />
          </View>
        }
        renderItem={({ item, index }) => {
          const record = state.records[item.recordId];
          if (!record) return null;
          return (
            <View>
              <RecordCard
                record={record}
                onPress={() => navigation.navigate("Record", { id: record.id })}
              />
              {organize && (
                <View style={s.row}>
                  <Button
                    title="上移"
                    disabled={index === 0}
                    onPress={() =>
                      action((s) => {
                        const items = s.albums[album.id]!.items;
                        [items[index - 1], items[index]] = [
                          items[index]!,
                          items[index - 1]!,
                        ];
                        s.albums[album.id]!.updatedAt = now();
                      })
                    }
                  />
                  <Button
                    title="下移"
                    disabled={index === album.items.length - 1}
                    onPress={() =>
                      action((s) => {
                        const items = s.albums[album.id]!.items;
                        [items[index + 1], items[index]] = [
                          items[index]!,
                          items[index + 1]!,
                        ];
                        s.albums[album.id]!.updatedAt = now();
                      })
                    }
                  />
                  <Button
                    title="移出相册"
                    onPress={() =>
                      action((s) => {
                        const a = s.albums[album.id]!;
                        a.items = a.items.filter((i) => i.id !== item.id);
                        if (
                          a.coverId &&
                          !a.items.some((i) =>
                            s.records[i.recordId]?.mediaIds.includes(
                              a.coverId!,
                            ),
                          )
                        )
                          a.coverId = null;
                        a.updatedAt = now();
                      })
                    }
                  />
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <Text>相册还没有记录，点「添加记录」开始整理。</Text>
        }
      />
    </Page>
  );
}
export function Picker({ route, navigation }: Props<"Picker">) {
  const store = useStore(),
    state = useLibrary(),
    s = useStyles();
  const q = state.selections[route.params.sessionId];
  const list = useRef<FlatList>(null),
    restored = useRef(false),
    offset = useRef(q?.offset ?? 0),
    offsetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [person, setPerson] = useState("");
  const records = sortedRecords(state),
    months = [...new Set(records.map((r) => monthKey(r.date)))];
  const personList = Object.values(state.persons).sort((a, b) =>
      a.name.localeCompare(b.name, "zh"),
    );
  const patch = (fn: (next: NonNullable<typeof q>) => void) => {
    void store
      .change((s) => {
        const next = s.selections[route.params.sessionId];
        if (next) fn(next);
      })
      .catch((e) => setError(messageOf(e)));
  };
  // 滚动结束只做去抖落盘：拖动与惯性各触发一次，不能每次都整库写。
  const persistOffset = () => {
    if (offsetTimer.current) clearTimeout(offsetTimer.current);
    offsetTimer.current = setTimeout(() => {
      offsetTimer.current = null;
      patch((next) => {
        next.offset = Math.max(0, offset.current);
      });
    }, 700);
  };
  useEffect(
    () => () => {
      if (offsetTimer.current) {
        clearTimeout(offsetTimer.current);
        offsetTimer.current = null;
        void store
          .change((s) => {
            const next = s.selections[route.params.sessionId];
            if (next) next.offset = Math.max(0, offset.current);
          })
          .catch(() => {});
      }
    },
    [route.params.sessionId, store],
  );
  if (!q)
    return (
      <Page>
        <Text>选材已完成。</Text>
      </Page>
    );
  return (
    <Page scroll={false}>
      <View style={{ padding: 20, gap: 12 }}>
        <Text style={s.title}>选择回忆</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.row}>
            <Button
              title="全部月份"
              selected={!q.month}
              onPress={() =>
                patch((q) => {
                  q.month = "";
                  q.offset = 0;
                  list.current?.scrollToOffset({ offset: 0 });
                })
              }
            />
            {months.map((m) => (
              <Button
                key={m}
                title={m}
                selected={q.month === m}
                onPress={() =>
                  patch((q) => {
                    q.month = m;
                    q.offset = 0;
                    list.current?.scrollToOffset({ offset: 0 });
                  })
                }
              />
            ))}
          </View>
        </ScrollView>
        {personList.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.row}>
              <Button
                title="全部人物"
                selected={!person}
                onPress={() => setPerson("")}
              />
              {personList.map((p) => (
                <Button
                  key={p.id}
                  title={p.name}
                  selected={person === p.id}
                  onPress={() => setPerson(person === p.id ? "" : p.id)}
                />
              ))}
            </View>
          </ScrollView>
        )}
        <ErrorText message={error} />
      </View>
      <FlatList
        ref={list}
        testID="material-list"
        data={records.filter(
          (r) =>
            (!q.month || monthKey(r.date) === q.month) &&
            (!person || r.personIds?.includes(person)),
        )}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingHorizontal: 20 }}
        onContentSizeChange={() => {
          if (!restored.current) {
            restored.current = true;
            list.current?.scrollToOffset({ offset: q.offset, animated: false });
          }
        }}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={100}
        onScrollEndDrag={persistOffset}
        onMomentumScrollEnd={persistOffset}
        renderItem={({ item }) => (
          <RecordCard
            record={item}
            selected={q.selected.includes(item.id)}
            onPress={() =>
              patch((q) => {
                q.selected = q.selected.includes(item.id)
                  ? q.selected.filter((id) => id !== item.id)
                  : [...q.selected, item.id];
                if (
                  q.coverId &&
                  !q.selected.some((id) =>
                    state.records[id]?.mediaIds.includes(q.coverId!),
                  )
                )
                  q.coverId = null;
              })
            }
          />
        )}
        ListEmptyComponent={
          <View style={s.content}>
            <Text>这个月份还没有记录。</Text>
          </View>
        }
      />
      <BottomBar>
        <Text>已选 {q.selected.length} 条</Text>
        <Button
          title={q.albumId ? "加入此相册" : "下一步"}
          testID="material-done"
          primary
          disabled={!q.selected.length || busy}
          onPress={() => {
            if (!q.albumId) {
              navigation.navigate("AlbumDetails", { sessionId: q.id });
              return;
            }
            setBusy(true);
            void store
              .change((s) => finishSelection(s, q.id, newId(), newId, now()))
              .then((album) => navigation.popTo("Album", { id: album.id }))
              .catch((e) => setError(messageOf(e)))
              .finally(() => setBusy(false));
          }}
        />
      </BottomBar>
    </Page>
  );
}
export function AlbumDetails({ route, navigation }: Props<"AlbumDetails">) {
  const store = useStore(),
    state = useLibrary(),
    s = useStyles(),
    q = state.selections[route.params.sessionId];
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(q?.name ?? ""),
    [returnAction, setReturnAction] = useState<NavigationAction | null>(null);
  usePreventRemove(Boolean(q && name !== q.name), ({ data }) => {
    void store
      .change((s) => {
        const session = s.selections[route.params.sessionId];
        if (session) session.name = name;
      })
      .then(() => setReturnAction(data.action))
      .catch((e) => setError(messageOf(e)));
  });
  useEffect(() => {
    if (returnAction && (!q || q.name === name)) {
      navigation.dispatch(returnAction);
    }
  }, [returnAction, q, name, navigation]);
  if (!q)
    return (
      <Page>
        <Text>相册已保存。</Text>
      </Page>
    );
  const photos = [
    ...new Set(q.selected.flatMap((id) => state.records[id]?.mediaIds ?? [])),
  ].filter((id) => state.media[id]?.kind === "image");
  const patch = (fn: (next: NonNullable<typeof q>) => void) => {
    void store
      .change((s) => {
        const next = s.selections[q.id];
        if (next) fn(next);
      })
      .catch((e) => setError(messageOf(e)));
  };
  return (
    <Page>
      <Text style={s.title}>给这段时光起个名字</Text>
      <Field
        label="相册名称"
        testID="album-name"
        placeholder="例如：一岁以前"
        value={name}
        editable={!busy}
        onChangeText={setName}
        onEndEditing={() =>
          patch((q) => {
            q.name = name;
          })
        }
      />
      <Text>已选 {q.selected.length} 条记录</Text>
      <Button title="返回调整内容" onPress={() => navigation.goBack()} />
      <Text style={s.heading}>选择封面</Text>
      {photos.map((id) => (
        <Pressable
          key={id}
          accessibilityRole="radio"
          accessibilityState={{ selected: q.coverId === id }}
          accessibilityLabel="选择这张封面"
          onPress={() =>
            patch((q) => {
              q.coverId = id;
            })
          }
        >
          <Photo media={state.media[id]} preview />
          {q.coverId === id && <Text>已选封面</Text>}
        </Pressable>
      ))}
      <ErrorText message={error} />
      <Button
        title="保存相册"
        testID="album-save"
        primary
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void store
            .change((s) => {
              const session = s.selections[q.id];
              if (session) session.name = name;
              return finishSelection(s, q.id, newId(), newId, now());
            })
            .then((album) => {
              navigation.popTo("Shelf");
              navigation.navigate("Album", { id: album.id });
            })
            .catch((e) => setError(messageOf(e)))
            .finally(() => setBusy(false));
        }}
      />
    </Page>
  );
}
