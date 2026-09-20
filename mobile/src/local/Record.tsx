import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import type { Svg } from "react-native-svg";
import * as Location from "expo-location";
import { useLibrary, useStore } from "./context";
import {
  addRecordsToAlbum,
  beginDraft,
  createAlbumWithRecords,
  now,
} from "./services";
import { deleteRecord, editEntity } from "./model";
import { looksLikeCoordinates, placeLabel } from "./places";
import type { Props } from "./navigation";
import {
  BottomBar,
  Button,
  Card,
  DateStrip,
  ErrorText,
  IconButton,
  Page,
  Text,
  dateLabel,
  messageOf,
  useStyles,
  useTheme,
} from "./ui";
import { Photo, PhotoDetails } from "./Media";
import {
  KeepSakeCard,
  exportKeepSakeCard,
  prepareKeepSakePhoto,
} from "./KeepSakeCard";
export function RecordScreen({ route, navigation }: Props<"Record">) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles(),
    { colors } = useTheme();
  const { width } = useWindowDimensions();
  const record = state.records[route.params.id],
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [chooseAlbum, setChooseAlbum] = useState(false),
    [photoIndex, setPhotoIndex] = useState(0);
  const pager = useRef<ScrollView>(null);
  const cardRef = useRef<Svg | null>(null),
    [card, setCard] = useState<{
      photo?: { uri: string; aspect: number };
    } | null>(null),
    [cardBusy, setCardBusy] = useState(false),
    [placeBusy, setPlaceBusy] = useState(false);
  useEffect(() => {
    if (!card || !cardBusy || !record) return;
    let cancelled = false;
    // 两帧之后再取图，确保离屏 Svg 完成布局与位图合成。
    const first = requestAnimationFrame(() =>
      requestAnimationFrame(async () => {
        if (cancelled) return;
        try {
          await exportKeepSakeCard(cardRef.current, record.id);
        } catch (e) {
          setError(messageOf(e));
        } finally {
          setCardBusy(false);
          setCard(null);
        }
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(first);
    };
  }, [card, cardBusy, record]);
  if (!record)
    return (
      <Page>
        <Text>这段时光已删除。</Text>
      </Page>
    );
  const makeKeepSake = async () => {
    setCardBusy(true);
    setError("");
    try {
      const cover =
        (record.coverId ? state.media[record.coverId] : undefined)?.kind ===
        "image"
          ? state.media[record.coverId!]
          : Object.values(state.media).find(
              (m) => m.kind === "image" && record.mediaIds.includes(m.id),
            );
      setCard({ photo: await prepareKeepSakePhoto(cover) });
    } catch (e) {
      setError(messageOf(e));
      setCardBusy(false);
    }
  };
  const photoPlace = record.mediaIds
    .map((id) => state.media[id]?.photoMetadata)
    .find((m) => m?.latitude !== undefined && m.longitude !== undefined);
  const canNamePlace =
    !!photoPlace &&
    (!record.location.trim() || looksLikeCoordinates(record.location));
  const namePlace = async () => {
    if (!photoPlace) return;
    setPlaceBusy(true);
    setError("");
    try {
      // 逆地理只需要把已知坐标换成地名；Android 的 Geocoder 前置要求定位权限。
      if (Platform.OS === "android") {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted)
          throw new Error("请在系统设置中允许使用定位后，再查拍摄地点的地名。");
      }
      const [candidate] = await Location.reverseGeocodeAsync({
        latitude: photoPlace.latitude!,
        longitude: photoPlace.longitude!,
      });
      const label = placeLabel(candidate, record.location);
      if (label === record.location)
        throw new Error("没有查到这组坐标的地名，地点保持原样。");
      Alert.alert("用这个地名？", label, [
        { text: "取消", style: "cancel" },
        {
          text: "写入地点",
          onPress: () => {
            void store
              .change((lib) => {
                editEntity(lib, "records", record.id, (target) => {
                  target.location = label;
                });
              })
              .catch((e) => setError(messageOf(e)));
          },
        },
      ]);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPlaceBusy(false);
    }
  };
  const toggle = (key: "first" | "quote") => {
    void store
      .change((lib) => {
        editEntity(lib, "records", record.id, (r) => {
          if (key === "first") r.first = !r.first;
          else r.quote = !r.quote;
          r.revision++;
          r.updatedAt = now();
        });
      })
      .catch((e) => setError(messageOf(e)));
  };
  const albums = Object.values(state.albums).sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
  const addTo = (albumId: string) => {
    void addRecordsToAlbum(store, albumId, [record.id])
      .then((album) => {
        setChooseAlbum(false);
        setMessage(`已加入「${album.name}」。`);
      })
      .catch((e) => setError(messageOf(e)));
  };
  const createAlbum = () => {
    void createAlbumWithRecords(store, [record.id])
      .then((id) => {
        setChooseAlbum(false);
        navigation.navigate("Album", { id });
      })
      .catch((e) => setError(messageOf(e)));
  };
  // 同一记录多张照片横向分页连翻；其他素材在正文后逐条列出。
  const photos = record.mediaIds
    .map((id) => state.media[id])
    .filter((m): m is NonNullable<typeof m> => m?.kind === "image");
  const others = record.mediaIds
    .map((id) => state.media[id])
    .filter((m): m is NonNullable<typeof m> => !!m && m.kind !== "image");
  const currentIndex = Math.min(photoIndex, Math.max(photos.length - 1, 0));
  const photoWidth = width - 40;
  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(i, photos.length - 1));
    setPhotoIndex(next);
    pager.current?.scrollTo({ x: next * photoWidth, animated: true });
  };
  const kindLabel = (kind: string) =>
    kind === "audio" ? "听录音" : kind === "video" ? "看视频" : "打开文件";
  return (
    <Page scroll={false}>
      <ScrollView contentContainerStyle={s.content}>
        {photos.length > 0 && (
          <View style={{ gap: 8 }}>
            <ScrollView
              ref={pager}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEnabled={photos.length > 1}
              onMomentumScrollEnd={(e) =>
                setPhotoIndex(
                  Math.round(e.nativeEvent.contentOffset.x / photoWidth),
                )
              }
            >
              {photos.map((media, i) => (
                <Pressable
                  key={media.id}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={
                    photos.length > 1
                      ? `第 ${i + 1} 张照片，共 ${photos.length} 张，点开看原图`
                      : "照片，点开看原图"
                  }
                  onPress={() =>
                    navigation.navigate("Media", {
                      id: media.id,
                      recordId: record.id,
                    })
                  }
                  style={{ width: photoWidth }}
                >
                  <Photo media={media} contain />
                </Pressable>
              ))}
            </ScrollView>
            {photos.length > 1 && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <IconButton
                  label="上一张"
                  icon="arrow-left"
                  testID="record-photo-prev"
                  onPress={() => goTo(currentIndex - 1)}
                />
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {photos.map((m, i) => (
                    <View
                      key={m.id}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor:
                          i === currentIndex ? colors.accent : colors.line,
                      }}
                    />
                  ))}
                </View>
                <IconButton
                  label="下一张"
                  icon="chevron-right"
                  testID="record-photo-next"
                  onPress={() => goTo(currentIndex + 1)}
                />
              </View>
            )}
            <PhotoDetails media={photos[currentIndex]!} />
          </View>
        )}
        <DateStrip>
          <Text style={[s.muted, { color: colors.accent, fontWeight: "600" }]}>
            {dateLabel(record.date)}
            {record.first ? " · 第一次" : ""}
          </Text>
        </DateStrip>
        {(record.personIds?.length ?? 0) > 0 && (
          <View style={s.row}>
            {record
              .personIds!.map((id) => state.persons[id])
              .filter((p): p is NonNullable<typeof p> => !!p)
              .map((person) => (
                <View
                  key={person.id}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 4,
                    borderRadius: 12,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.glassLine,
                  }}
                >
                  <Text style={s.muted}>{person.name}</Text>
                </View>
              ))}
          </View>
        )}
        {/* 没起标题的记录不再拿正文首行充当标题：正文就在下面，重复一遍只会显得怪。 */}
        {!!record.title.trim() && (
          <Text style={s.heading}>{record.title.trim()}</Text>
        )}
        {!!record.text && <Text selectable>{record.text}</Text>}
        {!!record.location && (
          <Text style={s.muted} selectable>
            {record.location}
          </Text>
        )}
        {canNamePlace && (
          <View style={s.row}>
            <Button
              title={placeBusy ? "正在查询地名…" : "把地点换成地名"}
              kind="text"
              compact
              icon="pin"
              testID="place-resolve"
              disabled={placeBusy}
              onPress={() => {
                void namePlace();
              }}
            />
          </View>
        )}
        {others.length > 0 && (
          <View style={s.row}>
            {others.map((media) => {
              const sameKind = others.filter((o) => o.kind === media.kind);
              const ordinal =
                sameKind.length > 1 ? ` ${sameKind.indexOf(media) + 1}` : "";
              return (
                <Button
                  key={media.id}
                  title={kindLabel(media.kind) + ordinal}
                  kind="text"
                  compact
                  icon={
                    media.kind === "audio"
                      ? "audio"
                      : media.kind === "video"
                        ? "video"
                        : "file"
                  }
                  onPress={() =>
                    navigation.navigate("Media", {
                      id: media.id,
                      recordId: record.id,
                    })
                  }
                />
              );
            })}
          </View>
        )}
        <View style={s.row}>
          <Button
            title="第一次"
            compact
            selected={record.first}
            icon="star"
            onPress={() => toggle("first")}
          />
          <Button
            title="她说的话"
            compact
            selected={!!record.quote}
            icon="quote"
            testID="record-quote"
            onPress={() => toggle("quote")}
          />
        </View>
        {chooseAlbum && (
          <Card>
            <Text style={s.heading}>加入相册</Text>
            {albums.length > 0 ? (
              <View style={s.row}>
                {albums.map((a) => {
                  const inAlbum = a.items.some((i) => i.recordId === record.id);
                  return (
                    <Button
                      key={a.id}
                      title={a.name}
                      compact
                      selected={inAlbum}
                      disabled={inAlbum}
                      onPress={() => addTo(a.id)}
                    />
                  );
                })}
              </View>
            ) : (
              <Text style={s.muted}>还没有相册，用这一刻建一本吧。</Text>
            )}
            <View style={s.row}>
              <Button
                title="新建相册"
                kind="text"
                compact
                icon="plus"
                onPress={createAlbum}
              />
            </View>
          </Card>
        )}
        {!!message && (
          <Text style={s.muted} accessibilityLiveRegion="polite">
            {message}
          </Text>
        )}
        <ErrorText message={error} />
        {card && (
          <View
            pointerEvents="none"
            style={{ position: "absolute", left: -10000, top: 0, opacity: 0 }}
          >
            <KeepSakeCard
              ref={cardRef}
              record={record}
              profileName={state.profile.name}
              photo={card.photo}
            />
          </View>
        )}
        <View style={{ alignItems: "center", paddingTop: 8 }}>
          <Button
            title="删除记录"
            kind="text"
            danger
            onPress={() =>
              Alert.alert(
                "删除这段时光？",
                "它也会从所有相册里移出，删了就找不回来。",
                [
                  { text: "取消", style: "cancel" },
                  {
                    text: "删除记录",
                    style: "destructive",
                    onPress: () => {
                      void store
                        .change((lib) => deleteRecord(lib, record.id))
                        .then(() => navigation.goBack())
                        .catch((e) => setError(messageOf(e)));
                    },
                  },
                ],
              )
            }
          />
        </View>
      </ScrollView>
      <BottomBar>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              title="编辑"
              primary
              icon="edit"
              testID="record-edit"
              onPress={() => {
                void beginDraft(store, record.id)
                  .then((draftId) => navigation.navigate("Editor", { draftId }))
                  .catch((e) => setError(messageOf(e)));
              }}
            />
          </View>
          <Button
            title="加入相册"
            compact
            onPress={() => setChooseAlbum(!chooseAlbum)}
          />
          <Button
            title={cardBusy ? "正在生成…" : "纪念卡"}
            compact
            testID="keepsake-make"
            disabled={cardBusy}
            onPress={() => {
              void makeKeepSake();
            }}
          />
        </View>
      </BottomBar>
    </Page>
  );
}
