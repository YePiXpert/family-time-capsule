import { useEffect, useState } from "react";
import { AccessibilityInfo, Alert, Pressable, View } from "react-native";
import Animated, {
  Easing,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useLibrary, useStore } from "./context";
import { letterCaption, letterState, openAtLabel } from "./letters";
import { letterSeal, type LocalMedia } from "./model";
import type { Props } from "./navigation";
import { deleteLetter, openLetter } from "./services";
import {
  Button,
  ErrorText,
  MOTION,
  Page,
  Stamp,
  Text,
  dateLabel,
  messageOf,
  serif,
  useStyles,
  useTheme,
} from "./ui";

/** 印章落定：从略大、略斜、透明压到原位，一次，不回弹。印章是实色描线，不是玻璃，可以淡入。 */
const STAMP_IN = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 1.5 }, { rotate: "-12deg" }] },
  100: {
    opacity: 1,
    transform: [{ scale: 1 }, { rotate: "0deg" }],
    easing: Easing.out(Easing.cubic),
  },
}).duration(MOTION.seal);
const STAMP = 96;
export function LetterScreen({ route, navigation }: Props<"Letter">) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles(),
    { colors, large, reduceMotion } = useTheme();
  const letter = state.letters[route.params.id];
  const [error, setError] = useState("");
  const today = new Date();
  const status = letter ? letterState(letter, today) : null;
  const id = route.params.id;
  useEffect(() => {
    // 草稿没有阅读态：直接转去写信页。
    if (status === "draft") navigation.replace("LetterEditor", { id });
  }, [status, navigation, id]);
  // 刚封存成功才落一次印（写信页在 sealLetter 写入之后才带这个参数过来）。参数读完就清：
  // 再进这封信、回到这页、同步来的同一封信都不再播；中途离开只是不看完，封存早已落盘。
  const [justSealed] = useState(route.params.sealed === true);
  const [landed, setLanded] = useState(!justSealed || reduceMotion);
  const give = useSharedValue(1);
  const envelopeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: give.value }],
  }));
  useEffect(() => {
    if (route.params.sealed) navigation.setParams({ sealed: undefined });
  }, [route.params.sealed, navigation]);
  useEffect(() => {
    if (justSealed) AccessibilityInfo.announceForAccessibility("这封信封好了。");
  }, [justSealed]);
  useEffect(() => {
    if (landed) return;
    // 等原生转场停稳再落印，不跟页面推进叠成两套位移；转场事件没来也不让印一直空着。
    const land = () => setLanded(true);
    const unsubscribe = navigation.addListener("transitionEnd", land);
    const timer = setTimeout(land, 800);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [landed, navigation]);
  useEffect(() => {
    if (!justSealed || !landed || reduceMotion) return;
    // 印压下去的那一下，信封跟着微微一收再回来。
    // eslint-disable-next-line react-hooks/immutability -- reanimated 共享值的就地修改是其既定用法
    give.value = withDelay(
      MOTION.seal * 0.6,
      withSequence(
        withTiming(0.985, { duration: 90 }),
        withTiming(1, { duration: 180 }),
      ),
    );
  }, [justSealed, landed, reduceMotion, give]);
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
      `这封信封存到 ${openAtLabel(letter.openAt)}。提前拆开，就不再等那一天了。`,
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
        <Animated.View
          testID="letter-envelope"
          style={[
            s.section,
            { alignItems: "center", gap: 12, paddingVertical: 36 },
            envelopeStyle,
          ]}
        >
          {/* 落印前先占住印章的位置，信封不跳。 */}
          <View style={{ width: STAMP, height: STAMP }}>
            {landed && (
              <Animated.View
                testID={justSealed ? "letter-seal-landed" : undefined}
                entering={justSealed && !reduceMotion ? STAMP_IN : undefined}
              >
                <Stamp size={STAMP} inset={8}>
                  {/* 行高要跟字号走：默认行高 25 在 iOS 上会切掉 34 号字的上半截。 */}
                  <Text
                    maxFontSizeMultiplier={1}
                    style={{
                      fontFamily: serif,
                      fontSize: 34,
                      lineHeight: 42,
                      fontWeight: "600",
                      color: colors.accent,
                    }}
                  >
                    {letterSeal(letter.from)}
                  </Text>
                </Stamp>
              </Animated.View>
            )}
          </View>
          <Text style={[s.title, { textAlign: "center" }]}>{title}</Text>
          <Text style={s.heading}>
            {justSealed
              ? "封好了"
              : status === "openable"
                ? "可以拆了"
                : "还没到日子"}
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
        </Animated.View>
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
