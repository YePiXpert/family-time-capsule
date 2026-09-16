import { useState } from "react";
import { Alert, View } from "react-native";
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
} from "./ui";
import { Photo, PhotoDetails } from "./Media";
export function RecordScreen({ route, navigation }: Props<"Record">) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const record = state.records[route.params.id],
    [error, setError] = useState(""),
    [chooseAlbum, setChooseAlbum] = useState(false);
  if (!record)
    return (
      <Page>
        <Text>这条记录已删除。</Text>
      </Page>
    );
  const add = (albumId: string | null) => {
    void beginSelection(store, albumId, [record.id])
      .then((sessionId) => navigation.navigate("Picker", { sessionId }))
      .catch((e) => setError(messageOf(e)));
  };
  return (
    <Page>
      <Text style={s.muted}>
        {dateLabel(record.date)}
        {record.first ? " · 第一次" : ""}
      </Text>
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
      {chooseAlbum && (
        <View style={s.section}>
          {Object.values(state.albums).map((a) => (
            <Button key={a.id} title={a.name} onPress={() => add(a.id)} />
          ))}
          <Button title="新建相册" onPress={() => add(null)} />
        </View>
      )}
      {record.text && <Text>{record.text}</Text>}
      {record.location && <Text style={s.muted}>{record.location}</Text>}
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
      <ErrorText message={error} />
      <Button
        title="删除记录"
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
      />
    </Page>
  );
}
