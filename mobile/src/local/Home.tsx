import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { useLibrary, useStore } from "./context";
import { beginDraft, beginSelection } from "./services";
import {
  monthKey,
  recordTitle,
  sortedRecords,
  type LocalRecord,
} from "./model";
import { useNav } from "./navigation";
import {
  Button,
  ErrorText,
  Field,
  Page,
  Text,
  dateLabel,
  messageOf,
  useStyles,
  useTheme,
} from "./ui";
import { Photo } from "./Media";
export function RecordCard({
  record,
  selected,
  onPress,
}: {
  record: LocalRecord;
  selected?: boolean;
  onPress: () => void;
}) {
  const state = useLibrary(),
    s = useStyles(),
    { colors } = useTheme();
  const cover =
    state.media[record.coverId ?? ""] ??
    record.mediaIds
      .map((id) => state.media[id])
      .find((m) => m?.kind === "image");
  return (
    <Pressable
      testID={`record-${record.id}`}
      accessibilityRole={selected === undefined ? "button" : "checkbox"}
      accessibilityState={selected === undefined ? {} : { checked: selected }}
      accessibilityLabel={`${selected === undefined ? "" : selected ? "已选，" : "未选，"}${recordTitle(record)}`}
      onPress={onPress}
      style={{ gap: 8, paddingBottom: 24 }}
    >
      {cover?.kind === "image" && <Photo media={cover} />}
      <View style={s.between}>
        <Text style={s.muted}>
          {dateLabel(record.date)}
          {record.first ? " · 第一次" : ""}
        </Text>
        {selected !== undefined && (
          <Text style={{ color: colors.accent, width: 28 }}>
            {selected ? "●" : "○"}
          </Text>
        )}
      </View>
      {record.title ? <Text style={s.heading}>{record.title}</Text> : null}
      {record.text ? <Text numberOfLines={3}>{record.text}</Text> : null}
      {!cover && record.mediaIds.length > 0 && (
        <Text style={s.muted}>{record.mediaIds.length} 份声音或视频等素材</Text>
      )}
    </Pressable>
  );
}
export function CaptureDock() {
  const store = useStore(),
    nav = useNav(),
    s = useStyles();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
      <ErrorText message={error} />
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Button
            title="记一刻"
            icon="plus"
            primary
            testID="capture-new"
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void beginDraft(store)
                .then((draftId) => nav.navigate("Editor", { draftId }))
                .catch((e) => setError(messageOf(e)))
                .finally(() => setBusy(false));
            }}
          />
        </View>
      </View>
    </View>
  );
}
export function Timeline() {
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles();
  const [query, setQuery] = useState(""),
    [month, setMonth] = useState(""),
    [first, setFirst] = useState(false),
    [error, setError] = useState("");
  const records = useMemo(() => sortedRecords(state), [state]);
  const months = [...new Set(records.map((r) => monthKey(r.date)))];
  const visible = records.filter(
    (r) =>
      (!month || monthKey(r.date) === month) &&
      (!first || r.first) &&
      `${r.title}\n${r.text}\n${r.location}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const drafts = Object.values(state.drafts).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  return (
    <Page scroll={false}>
      <FlatList
        data={visible}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 20 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 20 }}>
            <View style={s.between}>
              <View>
                <Text style={s.title}>
                  {state.profile.name
                    ? `${state.profile.name}的成长记`
                    : "成长中的每一天"}
                </Text>
                <Text style={s.muted}>
                  {records.length
                    ? `${records.length} 段珍贵时光`
                    : "从今天的一件小事开始"}
                </Text>
              </View>
              <Button
                title="选择"
                testID="timeline-select"
                onPress={() => {
                  void beginSelection(store)
                    .then((sessionId) => nav.navigate("Picker", { sessionId }))
                    .catch((e) => setError(messageOf(e)));
                }}
              />
            </View>
            <Field
              label="搜索记录"
              placeholder="搜索文字、标题或地点"
              value={query}
              onChangeText={setQuery}
              testID="record-search"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={s.row}>
                <Button
                  title="全部月份"
                  selected={!month}
                  onPress={() => setMonth("")}
                />
                {months.map((m) => (
                  <Button
                    key={m}
                    title={m}
                    selected={month === m}
                    onPress={() => setMonth(m)}
                  />
                ))}
                <Button
                  title="第一次"
                  selected={first}
                  onPress={() => setFirst(!first)}
                />
              </View>
            </ScrollView>
            {drafts.map((d) => (
              <View key={d.id} style={s.section}>
                <Text style={s.heading}>继续记录</Text>
                <Text numberOfLines={2}>{recordTitle(d.content)}</Text>
                <Button
                  title="继续编辑"
                  testID={`resume-${d.id}`}
                  onPress={() => nav.navigate("Editor", { draftId: d.id })}
                />
              </View>
            ))}
            <ErrorText message={error} />
          </View>
        }
        renderItem={({ item }) => (
          <RecordCard
            record={item}
            onPress={() => nav.navigate("Record", { id: item.id })}
          />
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.heading}>
              {records.length ? "没有找到这段记录" : "把今天的小事留下来"}
            </Text>
            <Text style={s.muted}>
              {records.length
                ? "试试其他关键词或月份。"
                : "点下方「记一刻」，写几句话，留一张照片。"}
            </Text>
          </View>
        }
      />
      <CaptureDock />
    </Page>
  );
}
