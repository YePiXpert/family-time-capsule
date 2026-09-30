import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import {
  usePreventRemove,
  type NavigationAction,
} from "@react-navigation/native";
import { useLibrary, useStore } from "./context";
import { restoreRecordVersion } from "./history";
import { lineage } from "./hash";
import { letterState } from "./letters";
import type { Props } from "./navigation";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Page,
  Text,
  dateLabel,
  messageOf,
  useStyles,
} from "./ui";

export function HistoryScreen({ route, navigation }: Props<"History">) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const { id, kind } = route.params;
  const entity = state[kind][id];
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (
    kind === "letters" &&
    state.letters[id] &&
    letterState(state.letters[id]) === "sealed"
  )
    return (
      <Page title="修改历史">
        <Text>请先拆开这封信，再查看正文与历史。</Text>
      </Page>
    );
  const restore = (versionId: string) => {
    Alert.alert(
      "恢复这份内容？",
      "会保存为一个新版本，其他历史版本仍然保留。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "恢复",
          onPress: () => {
            setBusy(true);
            setError("");
            void store
              .change((lib) => {
                const at = new Date().toISOString();
                if (kind === "records")
                  restoreRecordVersion(lib, id, versionId, at);
                else {
                  const current = lib.letters[id],
                    old = current?.history?.find(
                      (h) => h.id === versionId,
                    )?.letter;
                  if (!current || !old)
                    throw new Error("这份历史版本已不存在。");
                  lib.letters[id] = {
                    ...old,
                    sealed: true,
                    openedAt: current.openedAt,
                    openedBy: current.openedBy,
                    history: current.history,
                    updatedAt: at,
                    ancestors: lineage(current),
                  };
                }
              })
              .catch((e) => setError(messageOf(e)))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };
  return (
    <Page title="修改历史">
      <ErrorText message={error} />
      {!entity?.history?.length && (
        <Text>这条内容还没有可查看的历史版本。</Text>
      )}
      {[...(entity?.history ?? [])].reverse().map((entry) => {
        const value = entry.record ?? entry.letter!;
        return (
          <Card key={entry.id}>
            <Text style={s.muted}>
              {entry.by} · {new Date(entry.at).toLocaleString("zh-CN")}
            </Text>
            {!!value.title && <Text style={s.heading}>{value.title}</Text>}
            <Text selectable>{value.text || "附件记录"}</Text>
            <View style={s.row}>
              {value.mediaIds.map((mediaId, i) => (
                <Button
                  key={mediaId}
                  title={`附件 ${i + 1}`}
                  kind="text"
                  onPress={() => navigation.navigate("Media", { id: mediaId })}
                />
              ))}
            </View>
            <Button
              title="恢复这份内容"
              disabled={busy}
              onPress={() => restore(entry.id)}
            />
          </Card>
        );
      })}
    </Page>
  );
}
export function LetterRevision({ route, navigation }: Props<"LetterRevision">) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const letter = state.letters[route.params.id];
  const [base] = useState(letter);
  const [title, setTitle] = useState(letter?.title ?? ""),
    [text, setText] = useState(letter?.text ?? "");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [leaving, setLeaving] = useState<NavigationAction | null>(null);
  const dirty = title !== base?.title || text !== base?.text;
  usePreventRemove((dirty || busy) && !leaving, ({ data }) => {
    if (busy) return;
    Alert.alert("修改还没保存", "继续写，或放弃这次修改。原信仍保留。", [
      { text: "继续写", style: "cancel" },
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
  const save = () => {
    setBusy(true);
    setError("");
    void store
      .change((lib) => {
        const current = lib.letters[route.params.id];
        if (!current || current !== base)
          throw new Error(
            "家人刚修改了这封信。你的文字还在，请返回核对后再保存。",
          );
        if (!text.trim() && !current.mediaIds.length)
          throw new Error("写几句话，或保留一个附件。");
        lib.letters[current.id] = {
          ...current,
          title,
          text,
          ancestors: lineage(current),
          updatedAt: new Date().toISOString(),
        };
      })
      .then(() => setLeaving({ type: "GO_BACK" }))
      .catch((e) => setError(messageOf(e)))
      .finally(() => setBusy(false));
  };
  if (!letter || letterState(letter) === "sealed")
    return (
      <Page title="编辑信">
        <Text>先拆开这封信，再修改内容。</Text>
      </Page>
    );
  return (
    <Page
      title="编辑信"
      right={<Button title="保存" disabled={busy || !dirty} onPress={save} />}
    >
      <Text style={s.muted}>
        写于 {dateLabel(letter.writtenAt)} · {letter.from}
        。修改后家人可见，旧版本保留。
      </Text>
      <Field
        label="标题（可选）"
        value={title}
        onChangeText={setTitle}
        maxLength={100}
        editable={!busy}
      />
      <Field
        label="写给她的话"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={5000}
        editable={!busy}
        style={{ minHeight: 280 }}
      />
      <ErrorText message={error} />
    </Page>
  );
}
