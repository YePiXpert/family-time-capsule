import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import type { Svg } from "react-native-svg";
import { useLibrary, useStore } from "./context";
import { beginDraft, beginSelection, now } from "./services";
import { deleteRecord, recordTitle } from "./model";
import type { Props } from "./navigation";
import {
  Button,
  ErrorText,
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
  const record = state.records[route.params.id],
    [error, setError] = useState(""),
    [chooseAlbum, setChooseAlbum] = useState(false);
  const cardRef = useRef<Svg | null>(null),
    [card, setCard] = useState<{
      photo?: { uri: string; aspect: number };
    } | null>(null),
    [cardBusy, setCardBusy] = useState(false);
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
        <Text>这条记录已删除。</Text>
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
  const add = (albumId: string | null) => {
    void beginSelection(store, albumId, [record.id])
      .then((sessionId) => navigation.navigate("Picker", { sessionId }))
      .catch((e) => setError(messageOf(e)));
  };
  return (
    <Page>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            width: 4,
            height: 16,
            borderRadius: 2,
            backgroundColor: colors.accent,
          }}
        />
        <Text style={[s.muted, { color: colors.accent }]}>
          {dateLabel(record.date)}
          {record.first ? " · 第一次" : ""}
        </Text>
      </View>
      <Text style={s.title}>{recordTitle(record)}</Text>
      <View style={s.row}>
        <Button
          title="编辑"
          testID="record-edit"
          icon="edit"
          onPress={() => {
            void beginDraft(store, record.id)
              .then((draftId) => navigation.navigate("Editor", { draftId }))
              .catch((e) => setError(messageOf(e)));
          }}
        />
        <Button
          title="第一次"
          selected={record.first}
          icon="star"
          onPress={() => {
            void store
              .change((s) => {
                const r = s.records[record.id];
                if (r) {
                  r.first = !r.first;
                  r.revision++;
                  r.updatedAt = now();
                }
              })
              .catch((e) => setError(messageOf(e)));
          }}
        />
        <Button
          title="加入相册"
          icon="book"
          onPress={() => setChooseAlbum(!chooseAlbum)}
        />
      </View>
      <View style={s.row}>
        <Button
          title={cardBusy ? "正在生成纪念卡…" : "做成纪念卡"}
          icon="heart"
          testID="keepsake-make"
          disabled={cardBusy}
          onPress={() => {
            void makeKeepSake();
          }}
        />
      </View>
      {chooseAlbum && (
        <View style={s.section}>
          {Object.values(state.albums).map((a) => (
            <Button key={a.id} title={a.name} onPress={() => add(a.id)} />
          ))}
          <Button title="新建相册" onPress={() => add(null)} />
        </View>
      )}
      {record.text && <Text selectable>{record.text}</Text>}
      {record.location && <Text style={s.muted}>{record.location}</Text>}
      <View style={{ gap: 16 }}>
        {record.mediaIds.map((id) => {
          const media = state.media[id];
          return media ? (
            <View key={id} style={{ gap: 8 }}>
              {media.kind === "image" && <Photo media={media} contain />}
              <PhotoDetails media={media} />
              <Button
                title={media.kind === "image" ? "查看原图" : media.name}
                icon={
                  media.kind === "audio"
                    ? "audio"
                    : media.kind === "video"
                      ? "video"
                      : "file"
                }
                onPress={() => navigation.navigate("Media", { id })}
              />
            </View>
          ) : null;
        })}
      </View>
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="删除记录"
        onPress={() =>
          Alert.alert(
            "删除这条记录？",
            "它也会从所有相册中移除。此操作无法撤销。",
            [
              { text: "取消", style: "cancel" },
              {
                text: "删除记录",
                style: "destructive",
                onPress: () => {
                  void store
                    .change((s) => deleteRecord(s, record.id))
                    .then(() => navigation.goBack())
                    .catch((e) => setError(messageOf(e)));
                },
              },
            ],
          )
        }
        style={({ pressed }) => ({
          alignSelf: "center",
          minHeight: 44,
          justifyContent: "center",
          paddingHorizontal: 16,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={[s.muted, { fontSize: 14 }]}>删除记录</Text>
      </Pressable>
    </Page>
  );
}
