import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import {
  usePreventRemove,
  type NavigationAction,
} from "@react-navigation/native";
import { generateYearStory } from "../ai/stories";
import { useLibrary, useStore } from "./context";
import type { Props } from "./navigation";
import type { YearStory } from "./stories";
import {
  Button,
  ErrorText,
  Field,
  Page,
  Photo,
  Text,
  dateLabel,
  messageOf,
  useStyles,
} from "./ui";

export function StoryScreen({ route, navigation }: Props<"Story">) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const { year } = route.params;
  const story = state.yearStories?.[year];
  const [draft, setDraft] = useState<YearStory | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = useRef(story),
    request = useRef<AbortController | null>(null);
  const [leaving, setLeaving] = useState<NavigationAction | null>(null);
  usePreventRemove(!!draft && !leaving, ({ data }) => {
    if (busy) return;
    Alert.alert("故事还没保存", "继续编辑，或放弃这次修改。", [
      { text: "继续编辑", style: "cancel" },
      {
        text: "放弃修改",
        style: "destructive",
        onPress: () => setLeaving(data.action),
      },
    ]);
  });
  useEffect(() => {
    if (leaving) navigation.dispatch(leaving);
  }, [leaving, navigation]);
  useEffect(() => () => request.current?.abort(), []);
  const generate = () => {
    const run = () => {
      const controller = new AbortController();
      request.current = controller;
      setBusy(true);
      setError("");
      void generateYearStory(store, year, !!story, controller.signal)
        .catch((e) => {
          if (!controller.signal.aborted) setError(messageOf(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    };
    if (story)
      Alert.alert(
        "重新整理这一年？",
        "会替换当前年度故事，原始记录不变。若要保留手工修改，请先导出可阅读副本。",
        [
          { text: "取消", style: "cancel" },
          { text: "重新整理", onPress: run },
        ],
      );
    else run();
  };
  const save = () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    void store
      .change((lib) => {
        if (lib.yearStories?.[year] !== base.current)
          throw new Error("家人已修改这篇故事，你的文字还在，请核对后重试。");
        lib.yearStories = {
          ...lib.yearStories,
          [year]: {
            ...draft,
            edited: true,
            updatedAt: new Date().toISOString(),
          },
        };
      })
      .then(() => setDraft(null))
      .catch((e) => setError(messageOf(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Page title={`${year} 年的故事`}>
      <ErrorText message={error} />
      {!story && (
        <>
          <Text style={s.heading}>把这一年慢慢读一遍</Text>
          <Text style={s.muted}>
            联网并完成同步后会自动整理。只根据家人写下的文字，照片留在手机上。
          </Text>
          <Button
            title={busy ? "正在整理…" : "整理这一年"}
            disabled={busy}
            primary
            onPress={generate}
          />
        </>
      )}
      {story && !draft && (
        <>
          <Text style={s.title}>{story.title}</Text>
          <Text style={s.muted}>
            AI 根据这一年的记录整理 · {dateLabel(story.generatedAt)}
            {story.edited ? " · 家人已修改" : ""}
          </Text>
          {story.paragraphs.map((p, i) => {
            const media = p.recordIds
              .flatMap((id) => state.records[id]?.mediaIds ?? [])
              .map((id) => state.media[id])
              .find((m) => m?.kind === "image");
            return (
              <View key={i} style={{ gap: 12 }}>
                <Text selectable>{p.text}</Text>
                {media && (
                  <Pressable
                    accessibilityRole="imagebutton"
                    accessibilityLabel="查看原图"
                    onPress={() =>
                      navigation.navigate("Media", { id: media.id })
                    }
                  >
                    <Photo media={media} preview contain />
                  </Pressable>
                )}
                <View style={s.row}>
                  {p.recordIds
                    .filter((id) => state.records[id])
                    .map((id, j) => (
                      <Button
                        key={id}
                        title={`原记录 ${j + 1}`}
                        kind="text"
                        compact
                        onPress={() => navigation.navigate("Record", { id })}
                      />
                    ))}
                </View>
              </View>
            );
          })}
          <View style={s.row}>
            <Button
              title="修改故事"
              disabled={busy}
              onPress={() => {
                base.current = story;
                setDraft({
                  ...story,
                  paragraphs: story.paragraphs.map((p) => ({
                    ...p,
                    recordIds: [...p.recordIds],
                  })),
                });
              }}
            />
            <Button
              title={busy ? "正在整理…" : "重新整理"}
              kind="text"
              disabled={busy}
              onPress={generate}
            />
          </View>
        </>
      )}
      {draft && (
        <>
          <Button title="保存修改" primary disabled={busy} onPress={save} />
          <Field
            label="标题"
            value={draft.title}
            maxLength={100}
            editable={!busy}
            onChangeText={(title) => setDraft({ ...draft, title })}
          />
          {draft.paragraphs.map((p, i) => (
            <Field
              key={i}
              label={`第 ${i + 1} 段`}
              value={p.text}
              multiline
              maxLength={1000}
              editable={!busy}
              onChangeText={(text) =>
                setDraft({
                  ...draft,
                  paragraphs: draft.paragraphs.map((v, n) =>
                    n === i ? { ...v, text } : v,
                  ),
                })
              }
            />
          ))}
          <Button
            title="取消修改"
            kind="text"
            disabled={busy}
            onPress={() => setDraft(null)}
          />
        </>
      )}
    </Page>
  );
}
