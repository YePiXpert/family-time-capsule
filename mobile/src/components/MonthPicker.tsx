import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { journalRadius, journalSpace } from "../design/tokens";
import { calendarMonthLabel } from "../utils/calendar-months";
import { useColorTheme } from "../theme";
import { GlassSheet } from "./GlassSheet";
import { JournalIcon } from "./JournalIcon";
import { Text } from "./typography";
import { Button, Chip } from "./ui";

/** Shared month selection; counts describe this device's archive, not server completeness. */
export function MonthPicker({ value, currentMonth, counts, onChange, allowAll = false }: {
  value: string;
  currentMonth: string;
  counts: ReadonlyMap<string, number>;
  onChange: (month: string) => void;
  allowAll?: boolean;
}) {
  const { colors } = useColorTheme();
  const { height } = useWindowDimensions();
  const [browsingYear, setBrowsingYear] = useState<number | null>(null);
  const [yearPage, setYearPage] = useState<number | null>(null);
  const years = useMemo(() => {
    const totals = new Map<number, number>();
    for (const [month, count] of counts) {
      const year = Number(month.slice(0, 4));
      totals.set(year, (totals.get(year) ?? 0) + count);
    }
    return totals;
  }, [counts]);
  const latest = useMemo(() => [...counts.keys()].sort().at(-1), [counts]);
  const title = value ? calendarMonthLabel(value) : "全部月份";
  const close = () => { setBrowsingYear(null); setYearPage(null); };
  const choose = (month: string) => { onChange(month); close(); };
  const open = () => {
    setBrowsingYear(Number((value || latest || currentMonth).slice(0, 4)));
    setYearPage(null);
  };
  return <>
    <Pressable testID="month-picker" accessibilityRole="button" accessibilityLabel={`按年月回看，${title}`} accessibilityState={{ expanded: browsingYear !== null }} onPress={open} style={({ pressed }) => [styles.trigger, { backgroundColor: colors.card, borderColor: colors.line }, pressed && styles.pressed]}>
      <View style={[styles.icon, { backgroundColor: colors.softCoral }]}><JournalIcon name="calendar" size={22} color={colors.coralDark} /></View>
      <View style={styles.triggerText}>
        <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.detail, { color: colors.muted }]}>{value ? `本机 ${counts.get(value) ?? 0} 条记录 · 点选年月` : latest ? `最近有记录：${calendarMonthLabel(latest)}` : "点选年份和月份，回看成长记录"}</Text>
      </View>
      <JournalIcon name="chevron-down" size={18} color={colors.muted} />
    </Pressable>
    {browsingYear !== null ? <GlassSheet visible onClose={close}>
      <ScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={styles.sheet} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>按年月回看</Text>
        <View style={styles.shortcuts}>
          {allowAll ? <Chip accessibilityRole="button" label="全部月份" selected={!value} onPress={() => choose("")} /> : null}
          <Chip accessibilityRole="button" label={`本月 · ${calendarMonthLabel(currentMonth)}`} selected={value === currentMonth} onPress={() => choose(currentMonth)} />
        </View>
        <View style={styles.yearRow}>
          <Button title={yearPage === null ? "上一年" : "更早"} icon="arrow-left" full={false} disabled={(yearPage ?? browsingYear) <= 1} onPress={() => yearPage === null ? setBrowsingYear(Math.max(1, browsingYear - 1)) : setYearPage(Math.max(1, yearPage - 12))} />
          <Pressable accessibilityRole="button" accessibilityLabel={yearPage === null ? `${browsingYear} 年，选择年份` : "返回月份"} onPress={() => setYearPage(yearPage === null ? Math.floor((browsingYear - 1) / 12) * 12 + 1 : null)} style={styles.yearLabel}>
            <Text style={[styles.year, { color: colors.ink }]}>{yearPage === null ? `${browsingYear} 年` : `${yearPage}—${Math.min(9999, yearPage + 11)}`}</Text>
            <Text style={[styles.detail, { color: colors.muted }]}>{yearPage === null ? "点选年份" : "返回月份"}</Text>
          </Pressable>
          <Button title={yearPage === null ? "下一年" : "更近"} icon="chevron-right" full={false} disabled={yearPage === null ? browsingYear >= 9999 : yearPage + 11 >= 9999} onPress={() => yearPage === null ? setBrowsingYear(Math.min(9999, browsingYear + 1)) : setYearPage(Math.min(9988, yearPage + 12))} />
        </View>
        <View style={styles.grid}>
          {Array.from({ length: yearPage === null ? 12 : Math.min(12, 10000 - yearPage) }, (_, index) => {
            const year = yearPage === null ? browsingYear : yearPage + index;
            const month = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
            const count = yearPage === null ? counts.get(month) ?? 0 : years.get(year) ?? 0;
            const selected = yearPage === null ? value === month : browsingYear === year;
            const label = yearPage === null ? `${index + 1} 月` : `${year} 年`;
            return <Pressable key={yearPage === null ? month : year} accessibilityRole="button" accessibilityLabel={`${yearPage === null ? calendarMonthLabel(month) : label}，本机 ${count} 条记录`} accessibilityState={{ selected }} onPress={() => {
              if (yearPage === null) choose(month);
              else { setBrowsingYear(year); setYearPage(null); }
            }} style={({ pressed }) => [styles.cell, { backgroundColor: selected ? colors.softCoral : colors.card, borderColor: selected ? colors.coral : colors.line }, pressed && styles.pressed]}>
              <Text style={[styles.month, { color: selected ? colors.coralDark : colors.ink }]}>{label}</Text>
              <Text style={[styles.detail, { color: colors.muted }]}>{count ? `${count} 条` : "本机暂无"}</Text>
            </Pressable>;
          })}
        </View>
        <Text style={[styles.note, { color: colors.muted }]}>条数来自本机保存的记录。未显示的资料可能尚未同步；时间只明确到年份或不详的记录，可以在成长页的全部月份中查看。</Text>
        <Button title="关闭月份选择" onPress={close} />
      </ScrollView>
    </GlassSheet> : null}
  </>;
}

const styles = StyleSheet.create({
  trigger: { minHeight: 72, borderWidth: 1, borderRadius: journalRadius.control, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  triggerText: { flex: 1, gap: 4 },
  title: { fontSize: 18, fontWeight: "600" },
  detail: { fontSize: 12 },
  heading: { fontSize: 22, fontWeight: "600" },
  sheet: { gap: journalSpace.medium, paddingBottom: 8 },
  shortcuts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  yearRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  yearLabel: { flexGrow: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 4 },
  year: { fontSize: 18, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { flexBasis: "29%", flexGrow: 1, minWidth: 80, minHeight: 76, paddingVertical: 12, paddingHorizontal: 8, gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: journalRadius.chip },
  month: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  note: { fontSize: 13 },
  pressed: { opacity: 0.72 },
});
