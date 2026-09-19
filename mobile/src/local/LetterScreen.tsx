import { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useLibrary, useStore } from "./context";
import { letterCaption, letterState } from "./letters";
import type { LocalMedia } from "./model";
import type { Props } from "./navigation";
import { deleteLetter, openLetter } from "./services";
import { Stamp } from "./Shelf";
import {
  Button,
  ErrorText,
  Page,
  Text,
  dateLabel,
  messageOf,
  serif,
  useStyles,
  useTheme,
} from "./ui";

export function LetterScreen({ route, navigation }: Props<"Letter">) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles(),
    { colors, large } = useTheme();
  const letter = state.letters[route.params.id];
  const [error, setError] = useState("");
  const today = new Date();
  const status = letter ? letterState(letter, today) : null;
  const id = route.params.id;
  useEffect(() => {
    // 草稿没有阅读态：直接转去写信页。
    if (status === "draft") navigation.replace("LetterEditor", { id });
  }, [status, navigation, id]);
  if (!letter)
    return (
      <Page>
        <Text>这封信已删除。</Text>
      </Page>
    );
  if (status === "draft") return <Page>{null}</Page>;
  const recordings = letter.mediaIds
    .map((mediaId) => state.media[mediaId])
    .filter((m): m is LocalMedia => m?.kind === "audio");
  const title = letter.title || "一封信";
  const open = (confirm: boolean) => {
    const go = () => {
      void openLetter(store, letter.id).catch((e) => setError(messageOf(e)));
    };
    if (!confirm) return go();
    Alert.alert(
      "现在就拆开？",
      `这封信封存到 ${letterCaption(letter, today).replace(/^封存至 /, "").replace(/ · .*$/, "")}。提前拆开，就不再等那一天了。`,
      [
        { text: "再等等", style: "cancel" },
        { text: "拆开", style: "destructive", onPress: go },
      ],
    );
  };
  const remove = () =>
    Alert.alert(
      "删除这封信？",
      status === "opened"
        ? "删除后无法找回。"
        : "封存的信删了就没有了，无法撤销。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            void deleteLetter(store, letter.id)
              .then(() => navigation.goBack())
              .catch((e) => setError(messageOf(e)));
          },
        },
      ],
    );
  return (
    <Page>
      {status === "opened" ? (
        <>
          <Text style={s.title}>{title}</Text>
          <Text style={s.muted}>
            写于 {dateLabel(letter.writtenAt)}
            {letter.openedAt ? ` · 拆于 ${dateLabel(letter.openedAt)}` : ""}
          </Text>
          <Text
            selectable
            testID="letter-body"
            style={{
              fontFamily: serif,
              fontSize: large ? 19 : 17,
              lineHeight: large ? 32 : 29,
            }}
          >
            {letter.text}
          </Text>
          {!!letter.from && (
            <Text
              style={{
                alignSelf: "flex-end",
                fontFamily: serif,
                fontSize: large ? 19 : 17,
              }}
            >
              —— {letter.from}
            </Text>
          )}
          {recordings.map((media, i) => (
            <Button
              key={media.id}
              title={recordings.length > 1 ? `听录音 ${i + 1}` : "听录音"}
              icon="audio"
              onPress={() => navigation.navigate("Media", { id: media.id })}
            />
          ))}
        </>
      ) : (
        <View
          testID="letter-envelope"
          style={[
            s.section,
            { alignItems: "center", gap: 12, paddingVertical: 36 },
          ]}
        >
          <Stamp size={96} inset={8}>
            <Text
              style={{
                fontFamily: serif,
                fontSize: 34,
                fontWeight: "600",
                color: colors.accent,
              }}
            >
              {letter.from.trim().charAt(0) || "信"}
            </Text>
          </Stamp>
          <Text style={[s.title, { textAlign: "center" }]}>{title}</Text>
          <Text style={s.heading}>
            {status === "openable" ? "可以拆了" : "还没到日子"}
          </Text>
          <Text style={[s.muted, { textAlign: "center" }]}>
            {letterCaption(letter, today)}
          </Text>
          <Text style={s.muted}>写于 {dateLabel(letter.writtenAt)}</Text>
          {status === "openable" ? (
            <Button
              title="拆开这封信"
              icon="seal"
              primary
              testID="letter-open"
              onPress={() => open(false)}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="提前拆封"
              testID="letter-open-early"
              onPress={() => open(true)}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: 16,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: colors.accent }}>提前拆封</Text>
            </Pressable>
          )}
        </View>
      )}
      <ErrorText message={error} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="删除这封信"
        testID="letter-delete"
        onPress={remove}
        style={({ pressed }) => ({
          alignSelf: "center",
          minHeight: 44,
          justifyContent: "center",
          paddingHorizontal: 16,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={s.muted}>删除这封信</Text>
      </Pressable>
    </Page>
  );
}
