import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useLibrary, useStore } from "./context";
import { beginDraft, now } from "./services";
import { deleteRecord, patchRecord } from "./model";
import { pickAnother } from "./shuffle";
import { useFocusGuard, type Props } from "./navigation";
import {
  Button,
  DangerCard,
  ErrorText,
  Page,
  Photo,
  Text,
  dateLabel,
  messageOf,
  useStyles,
} from "./ui";

export function RecordScreen({ route, navigation }: Props<"Record">) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles(),
    guard = useFocusGuard();
  const record = state.records[route.params.id];
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  if (!record)
    return (
      <Page title="记录">
        <Text>这条记录已删除。</Text>
      </Page>
    );
  const toggle = (key: "first" | "quote") => {
    void store
      .change((lib) => {
        const r = lib.records[record.id];
        if (r) patchRecord(lib, r.id, { [key]: !r[key] }, now());
      })
      .catch((e) => setError(messageOf(e)));
  };
  const ids = Object.keys(state.records);
  return (
    <Page
      title="这一刻"
      right={
        route.params.shuffle && ids.length > 1 ? (
          <Button
            title="再翻一页"
            kind="text"
            compact
            testID="shuffle-next"
            onPress={() =>
              navigation.replace("Record", {
                id: pickAnother(ids, record.id)!,
                shuffle: true,
              })
            }
          />
        ) : undefined
      }
    >
      <Text style={s.muted}>
        {dateLabel(record.date)} · {record.by || "家人"}
      </Text>
      {!!record.title.trim() && <Text style={s.title}>{record.title}</Text>}
      {!!record.text && <Text selectable>{record.text}</Text>}
      {record.mediaIds.map((id, i) => {
        const media = state.media[id];
        if (!media) return null;
        return media.kind === "image" ? (
          <Pressable
            key={id}
            accessibilityRole="imagebutton"
            accessibilityLabel={`照片 ${i + 1}，点开查看原图`}
            onPress={() =>
              navigation.navigate("Media", { id, recordId: record.id })
            }
          >
            <Photo media={media} preview contain />
          </Pressable>
        ) : (
          <Button
            key={id}
            title={
              media.kind === "audio"
                ? `听录音 ${i + 1}`
                : media.kind === "video"
                  ? `看视频 ${i + 1}`
                  : `打开附件 ${i + 1}`
            }
            icon={
              media.kind === "audio"
                ? "audio"
                : media.kind === "video"
                  ? "video"
                  : "file"
            }
            onPress={() =>
              navigation.navigate("Media", { id, recordId: record.id })
            }
          />
        );
      })}
      {!!record.by && (
        <Text style={[s.muted, { alignSelf: "flex-end" }]} testID="record-by">
          —— {record.by}
        </Text>
      )}
      {!!record.location && <Text style={s.muted}>{record.location}</Text>}
      <View style={s.row}>
        <Button
          title="编辑"
          primary
          icon="edit"
          testID="record-edit"
          onPress={() => {
            if (!guard.take()) return;
            void beginDraft(store, record.id)
              .then((draftId) => navigation.navigate("Editor", { draftId }))
              .catch((e) => {
                guard.release();
                setError(messageOf(e));
              });
          }}
        />
        <Button
          title="修改历史"
          kind="text"
          onPress={() =>
            navigation.navigate("History", { id: record.id, kind: "records" })
          }
        />
      </View>
      <Button
        title={details ? "收起标记" : "记录标记"}
        kind="text"
        onPress={() => setDetails(!details)}
      />
      {details && (
        <View style={s.row}>
          <Button
            title="第一次"
            compact
            selected={record.first}
            onPress={() => toggle("first")}
          />
          <Button
            title="她说的话"
            compact
            selected={!!record.quote}
            testID="record-quote"
            onPress={() => toggle("quote")}
          />
        </View>
      )}
      <ErrorText message={error} />
      <DangerCard
        title="删除记录"
        testID="record-delete"
        onPress={() =>
          Alert.alert(
            "删除这条记录？",
            "同步后家人的时间线也会移除它。请先备份需要保留的内容。",
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
    </Page>
  );
}
