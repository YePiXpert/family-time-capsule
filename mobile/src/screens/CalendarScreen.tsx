import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ApiError, fetchMobileCalendar } from "../api/client";
import type { MobileCalendar } from "../types";
import type { RootStackParamList } from "../navigation/types";
import { useApp } from "../state/AppContext";
import { colors, sharedStyles } from "../theme";
import {
  addCalendarMonths,
  calendarDate,
  parseCalendarDate,
} from "../utils/calendar";

type Props = NativeStackScreenProps<RootStackParamList, "Calendar">;
export function CalendarScreen({ navigation }: Props) {
  const { credentials, family } = useApp();
  const [month, setMonth] = useState(() =>
    calendarDate(new Date(), family?.timezone || "UTC").slice(0, 7),
  );
  const [monthInput, setMonthInput] = useState(month);
  const [date, setDate] = useState("");
  const [person, setPerson] = useState("");
  const [media, setMedia] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tag, setTag] = useState("");
  const [data, setData] = useState<MobileCalendar | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const load = useCallback(
    async (cursor = "") => {
      const id = ++requestId.current;
      if (!credentials) {
        setData(null);
        setError("连接家庭服务器后可以按日历浏览已确认记忆。");
        return;
      }
      setBusy(true);
      setError("");
      try {
        const result = await fetchMobileCalendar(credentials, {
          month,
          date,
          person,
          media,
          tag,
          cursor,
        });
        if (id === requestId.current)
          setData((previous) =>
            cursor && previous
              ? { ...result, entries: [...previous.entries, ...result.entries] }
              : result,
          );
      } catch (reason) {
        if (id === requestId.current) {
          setData(null);
          setError(
            reason instanceof ApiError && reason.status === 0
              ? "当前无法联网。日历需要联网查询；本机时间轴和原件仍在。"
              : reason instanceof Error
                ? reason.message
                : "读取失败，请重试。",
          );
        }
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    },
    [credentials, month, date, person, media, tag],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        requestId.current++;
      };
    }, [load]),
  );
  const jump = (next: string, day = "") => {
    setMonth(next);
    setMonthInput(next);
    setDate(day);
  };
  const button = (label: string, action: () => void, selected = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={action}
      style={
        selected ? sharedStyles.primaryButton : sharedStyles.secondaryButton
      }
    >
      <Text
        style={selected ? sharedStyles.primaryText : sharedStyles.secondaryText}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <ScrollView
      style={sharedStyles.screen}
      contentContainerStyle={sharedStyles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={sharedStyles.title}>记忆日历</Text>
      <Text style={sharedStyles.body}>
        家庭时区 · {data?.timezone || family?.timezone || "UTC"}
      </Text>
      <Text style={sharedStyles.label}>年 / 月（YYYY-MM）</Text>
      <TextInput
        accessibilityLabel="年 / 月"
        style={sharedStyles.input}
        value={monthInput}
        onChangeText={setMonthInput}
        maxLength={7}
      />
      {button("跳转", () => {
        try {
          if (!/^\d{4}-\d{2}$/.test(monthInput)) throw new Error();
          parseCalendarDate(`${monthInput}-01`);
          jump(monthInput);
        } catch {
          setError("请填写有效月份，例如 2026-09。");
        }
      })}
      <View style={styles.wrap}>
        {button("上月", () =>
          jump(addCalendarMonths(`${month}-01`, -1).slice(0, 7)),
        )}
        {button("下月", () =>
          jump(addCalendarMonths(`${month}-01`, 1).slice(0, 7)),
        )}
      </View>
      <View style={styles.wrap}>
        {button("所有家人", () => setPerson(""), !person)}
        {data?.people.map((p) =>
          button(p.name, () => setPerson(p.id), person === p.id),
        )}
      </View>
      <View style={styles.wrap}>
        {[
          ["", "全部媒体"],
          ["image", "照片"],
          ["audio", "录音"],
          ["video", "视频"],
          ["document", "文档"],
        ].map(([v, label]) => button(label!, () => setMedia(v!), media === v))}
      </View>
      <Text style={sharedStyles.label}>标签</Text>
      <TextInput
        accessibilityLabel="标签"
        style={sharedStyles.input}
        value={tagInput}
        onChangeText={setTagInput}
        maxLength={50}
      />
      {button("筛选标签", () => setTag(tagInput.trim()))}
      <View style={styles.wrap}>
        {data?.ages.map((a) =>
          button(a.label, () => jump(a.date.slice(0, 7), a.date)),
        )}
      </View>
      {busy ? <ActivityIndicator color={colors.coral} /> : null}
      {error ? (
        <View accessibilityRole="alert">
          <Text style={sharedStyles.error}>{error}</Text>
          <Pressable
            onPress={() => void load()}
            style={sharedStyles.secondaryButton}
          >
            <Text style={sharedStyles.secondaryText}>重试</Text>
          </Pressable>
        </View>
      ) : null}
      {data ? (
        <>
          <View style={styles.grid}>
            {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
              <Text style={styles.weekday} key={d}>
                {d}
              </Text>
            ))}
            {Array.from(
              { length: parseCalendarDate(`${month}-01`).getUTCDay() },
              (_, i) => (
                <View style={styles.cell} key={`blank-${i}`} />
              ),
            )}
            {data.days.map((day) => (
              <Pressable
                accessibilityLabel={`${day.date}，${day.count} 条记忆`}
                accessibilityRole="button"
                accessibilityState={{ selected: date === day.date }}
                key={day.date}
                onPress={() => setDate(day.date)}
                style={[
                  styles.cell,
                  styles.day,
                  date === day.date && styles.selected,
                ]}
              >
                <Text style={styles.dayText}>{Number(day.date.slice(-2))}</Text>
                <Text style={styles.count}>{day.count || "—"}</Text>
                {day.covers[0] && credentials ? (
                  <Image
                    accessibilityLabel="当天记忆封面"
                    source={{
                      uri: `${credentials.serverUrl}/api/media/${encodeURIComponent(day.covers[0].assetId)}`,
                      headers: { Authorization: `Bearer ${credentials.token}` },
                    }}
                    style={styles.cover}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
          <Text style={sharedStyles.cardTitle}>{date || month} · 记忆</Text>
          {date ? button("整月记忆", () => setDate("")) : null}
          {data.entries.map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => navigation.navigate("Memory", { id: entry.id })}
              style={sharedStyles.card}
            >
              <Text style={sharedStyles.cardTitle}>{entry.title}</Text>
              <Text style={sharedStyles.body}>{entry.date}</Text>
            </Pressable>
          ))}
          {!data.entries.length ? (
            <Text style={sharedStyles.body}>没有符合条件的已确认记忆。</Text>
          ) : null}
          {data.nextCursor ? (
            <Pressable
              disabled={busy}
              onPress={() => void load(data.nextCursor!)}
              style={sharedStyles.secondaryButton}
            >
              <Text style={sharedStyles.secondaryText}>更早的记忆</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: {
    width: "14.28%",
    textAlign: "center",
    color: colors.muted,
    paddingVertical: 10,
  },
  cell: { width: "14.28%", minHeight: 86, padding: 2 },
  day: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 7,
    alignItems: "center",
  },
  selected: { backgroundColor: colors.softCoral, borderColor: colors.coral },
  dayText: { color: colors.ink, fontSize: 16 },
  count: { color: colors.muted, fontSize: 12 },
  cover: { width: "100%", height: 32, borderRadius: 4 },
});
