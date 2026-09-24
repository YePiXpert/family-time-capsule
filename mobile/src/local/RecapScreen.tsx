import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLibrary } from "./context";
import { recordTitle, sortedRecords, yearKey } from "./model";
import { useNav, type Props } from "./navigation";
import { byLine, recapOf } from "./recap";
import { Photo } from "./Media";
import {
  Card,
  Ornament,
  Page,
  Stamp,
  Text,
  dateLabel,
  monthLabel,
  serif,
  useStyles,
  useTheme,
} from "./ui";

export function RecapScreen({ route }: Props<"Recap">) {
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles(),
    { colors } = useTheme();
  const year = route.params.year;
  const records = useMemo(
    () => sortedRecords(state).filter((r) => yearKey(r.date) === year),
    [state, year],
  );
  const recap = useMemo(
    () => recapOf(records, state.media),
    [records, state.media],
  );
  const note = state.yearNotes[year];
  const stats = [
    `${records.length} 段时光`,
    recap.photos ? `${recap.photos} 张照片` : "",
    recap.av ? `${recap.av} 段影音` : "",
    recap.firsts.length ? `${recap.firsts.length} 个第一次` : "",
    recap.chars ? `共 ${recap.chars} 字` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Page>
      <View style={{ alignItems: "center", gap: 12, paddingVertical: 16 }}>
        <Stamp size={72}>
          {/* 印章里的年份是装饰，不跟系统字号放大，免得四个数字撑出圆环。 */}
          <Text
            maxFontSizeMultiplier={1}
            style={{
              fontFamily: serif,
              fontSize: 22,
              color: colors.accent,
              fontWeight: "600",
            }}
          >
            {year}
          </Text>
        </Stamp>
        <Text style={s.title}>{year} 年的回顾</Text>
        {!!stats && <Text style={s.muted}>{stats}</Text>}
        {recap.byCounts.length > 0 && (
          <Text style={s.muted}>{byLine(recap.byCounts)}</Text>
        )}
      </View>
      {!!recap.months.length && (
        <View style={{ gap: 12 }}>
          <Text style={[s.muted, { fontFamily: serif }]}>月度封面</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 20 }}
          >
            {recap.months.map((month) => (
              <Pressable
                key={month.month}
                accessibilityRole="button"
                accessibilityLabel={`${monthLabel(month.month)}，${month.count} 段时光`}
                onPress={() => nav.navigate("Month", { month: month.month })}
                style={{ width: 128, gap: 6 }}
              >
                {month.cover ? (
                  <Photo media={month.cover} preview />
                ) : (
                  <View style={[s.section, { height: 96 }]} />
                )}
                <Text numberOfLines={1}>{monthLabel(month.month)}</Text>
                <Text numberOfLines={1} style={s.muted}>
                  {month.count} 段时光
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      {!!recap.firsts.length && (
        <View style={{ gap: 12 }}>
          <Text style={[s.muted, { fontFamily: serif }]}>这一年的第一次</Text>
          {recap.firsts.map((record) => (
            <Pressable
              key={record.id}
              accessibilityRole="button"
              accessibilityLabel={`${recordTitle(record)}，${dateLabel(record.date)}`}
              onPress={() => nav.navigate("Record", { id: record.id })}
            >
              <Card compact style={{ paddingVertical: 12 }}>
                <Text style={s.muted}>{dateLabel(record.date)}</Text>
                <Text style={s.heading}>{recordTitle(record)}</Text>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
      {(note || !!recap.months.length) && (
        <View style={{ gap: 12, alignItems: "center" }}>
          {note && <Text style={{ textAlign: "center" }}>{note}</Text>}
          <Ornament />
        </View>
      )}
    </Page>
  );
}
