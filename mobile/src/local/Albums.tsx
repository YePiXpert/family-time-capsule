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
  useWindowDimensions,
} from "react-native";
import { useLibrary, useStore } from "./context";
import { beginSelection, newId, now } from "./services";
import {
  editEntity,
  finishSelection,
  monthKey,
  sortedRecords,
  type Mutable,
  type SelectionSession,
  type Stored,
} from "./model";
import type { Props } from "./navigation";
import {
  BottomBar,
  Button,
  Card,
  ErrorText,
  Field,
  Page,
  PersonChips,
  Text,
  messageOf,
  monthLabel,
  useStyles,
} from "./ui";
import { PhotoPicker } from "./PhotoPicker";
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
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        data={album.items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            {coverMedia && (
              <Photo media={coverMedia} preview label="相册封面" />
            )}
            <Text style={s.title}>{album.name}</Text>
            <Text style={s.muted}>{album.items.length} 段时光</Text>
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
              {photos.length > 0 && (
                <Button
                  title="换封面"
                  kind="text"
                  compact
                  onPress={() => setCover(!cover)}
                />
              )}
              <Button
                title={organize ? "完成整理" : "整理"}
                kind="text"
                compact
                selected={organize || undefined}
                onPress={() => setOrganize(!organize)}
              />
            </View>
            {organize && (
              <Card>
                <Field label="相册名称" value={name} onChangeText={setName} />
                <Button
                  title="保存名称"
                  onPress={() =>
                    action((s) =>
                      editEntity(s, "albums", album.id, (a) => {
                        a.name = name.trim() || "新相册";
                        a.updatedAt = now();
                      }),
                    )
                  }
                />
                <Button
                  title="删除相册"
                  kind="text"
                  danger
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
              </Card>
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
                      action((s) =>
                        editEntity(s, "albums", album.id, (a) => {
                          [a.items[index - 1], a.items[index]] = [
                            a.items[index]!,
                            a.items[index - 1]!,
                          ];
                          a.updatedAt = now();
                        }),
                      )
                    }
                  />
                  <Button
                    title="下移"
                    disabled={index === album.items.length - 1}
                    onPress={() =>
                      action((s) =>
                        editEntity(s, "albums", album.id, (a) => {
                          [a.items[index + 1], a.items[index]] = [
                            a.items[index]!,
                            a.items[index + 1]!,
                          ];
                          a.updatedAt = now();
                        }),
                      )
                    }
                  />
                  <Button
                    title="移出相册"
                    onPress={() =>
                      action((s) =>
                        editEntity(s, "albums", album.id, (a) => {
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
                        }),
                      )
                    }
                  />
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={s.muted}>相册还没有记录，点「添加记录」开始整理。</Text>
        }
        ListFooterComponent={
          <View style={{ paddingTop: 16 }}>
            <NoteCard
              heading="这本相册的话"
              placeholder="写几句这本相册想说的话…"
              emptyHint="翻完这些记录，留几句想对她说的话。"
              note={album.note ?? ""}
              testPrefix="album-note"
              onSave={async (value) => {
                await store.change((s) => {
                  if (!s.albums[album.id]) throw new Error("相册已删除。");
                  editEntity(s, "albums", album.id, (target) => {
                    if (value) target.note = value;
                    else delete target.note;
                    target.updatedAt = now();
                  });
                });
              }}
            />
          </View>
        }
      />
      <PhotoPicker
        visible={cover}
        title="选一张封面"
        empty="先添加含照片的记录，就能选择封面。"
        choices={photos.map((id) => ({
          mediaId: id,
          label: "选为相册封面",
        }))}
        onPick={(choice) => {
          action((s) =>
            editEntity(s, "albums", album.id, (a) => {
              a.coverId = choice.mediaId;
              a.updatedAt = now();
            }),
          );
          setCover(false);
        }}
        onClose={() => setCover(false)}
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
  const personList = Object.values(state.persons);
  const patch = (fn: (next: Mutable<Stored<SelectionSession>>) => void) => {
    void store
      .change((s) => {
        editEntity(s, "selections", route.params.sessionId, fn);
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
            editEntity(s, "selections", route.params.sessionId, (next) => {
              next.offset = Math.max(0, offset.current);
            });
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
    <Page scroll={false} title="选记录">
      <View style={{ padding: 20, paddingTop: 4, gap: 12 }}>
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
                title={monthLabel(m)}
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
            <PersonChips
              persons={personList}
              selected={person ? [person] : []}
              allLabel="全部人物"
              onAll={() => setPerson("")}
              onToggle={(id) => setPerson(person === id ? "" : id)}
            />
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
          <View style={s.empty}>
            <Text>这个月份还没有记录。</Text>
          </View>
        }
      />
      <BottomBar>
        <Text>已选 {q.selected.length} 段时光</Text>
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
  const { width } = useWindowDimensions();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(q?.name ?? ""),
    [returnAction, setReturnAction] = useState<NavigationAction | null>(null);
  usePreventRemove(Boolean(q && name !== q.name), ({ data }) => {
    void store
      .change((s) => {
        editEntity(s, "selections", route.params.sessionId, (session) => {
          session.name = name;
        });
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
  const patch = (fn: (next: Mutable<Stored<SelectionSession>>) => void) => {
    void store
      .change((s) => {
        editEntity(s, "selections", q.id, fn);
      })
      .catch((e) => setError(messageOf(e)));
  };
  const tile = (width - 40 - 12) / 2;
  return (
    <Page scroll={false} title="给这段时光起个名字">
      <FlatList
        // 名称输入框在列表头里：列表默认会把键盘弹起时的第一次点击吃掉当作收键盘，
        // 「返回调整内容」「保存相册」和选封面都会失灵一次，必须显式放行。
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        data={photos}
        keyExtractor={(id) => id}
        numColumns={2}
        accessibilityRole="radiogroup"
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={[s.content, { gap: 12 }]}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
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
            <Text>已选 {q.selected.length} 段时光</Text>
            <Button title="返回调整内容" onPress={() => navigation.goBack()} />
            <Text style={s.heading}>选择封面</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: q.coverId === item }}
            accessibilityLabel="选择这张封面"
            onPress={() =>
              patch((q) => {
                q.coverId = item;
              })
            }
            style={{ gap: 4 }}
          >
            <Photo media={state.media[item]} size={tile} />
            {q.coverId === item && <Text style={s.muted}>已选封面</Text>}
          </Pressable>
        )}
        ListFooterComponent={
          <View style={{ gap: 12, marginTop: 16 }}>
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
                    editEntity(s, "selections", q.id, (session) => {
                      session.name = name;
                    });
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
          </View>
        }
      />
    </Page>
  );
}
