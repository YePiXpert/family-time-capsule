import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  SectionList,
  View,
  useWindowDimensions,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  IconButton,
  Page,
  Text,
  dateLabel,
  messageOf,
  useStyles,
  useTheme,
} from "./ui";
import { JournalIcon } from "../components/JournalIcon";
import { Photo } from "./Media";

export function RecordCard({
  record,
  selected,
  onPress,
  tileSize,
}: {
  record: LocalRecord;
  selected?: boolean;
  onPress: () => void;
  tileSize?: number;
}) {
  const state = useLibrary(),
    s = useStyles(),
    { colors, large } = useTheme();
  const images = record.mediaIds
    .map((id) => state.media[id])
    .filter((m) => m?.kind === "image");
  const candidate = state.media[record.coverId ?? ""];
  const cover = candidate?.kind === "image" ? candidate : images[0];
  const firstMedia = state.media[record.mediaIds[0] ?? ""];
  const title =
    record.title.trim() ||
    record.text.trim() ||
    (cover
      ? "照片记录"
      : firstMedia?.kind === "audio"
        ? "声音记录"
        : firstMedia?.kind === "video"
          ? "视频记录"
          : "这一刻");
  const caption = record.title.trim() ? record.text.trim() : record.location;
  return (
    <Pressable
      testID={`record-${record.id}`}
      accessibilityRole={selected === undefined ? "button" : "checkbox"}
      accessibilityState={selected === undefined ? {} : { checked: selected }}
      accessibilityLabel={`${selected === undefined ? "" : selected ? "已选，" : "未选，"}${title}，${dateLabel(record.date)}`}
      onPress={onPress}
      style={({ pressed }) => [
        tileSize ? { width: tileSize } : s.recordRow,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View>
        {cover ? (
          <Photo media={cover} size={tileSize ?? 88} />
        ) : tileSize ? (
          <View
            style={[
              s.section,
              {
                width: tileSize,
                height: tileSize,
                justifyContent: "center",
                alignItems: "center",
                padding: 12,
              },
            ]}
          >
            <JournalIcon
              name={
                firstMedia?.kind === "audio"
                  ? "audio"
                  : firstMedia?.kind === "video"
                    ? "video"
                    : "edit"
              }
              color={colors.accent}
              size={28}
            />
            <Text numberOfLines={3} style={s.muted}>
              {record.text ||
                (firstMedia?.kind === "audio"
                  ? "听听这一刻"
                  : firstMedia?.kind === "video"
                    ? "一段影像"
                    : "写下的回忆")}
            </Text>
          </View>
        ) : null}
        {tileSize && (images.length > 1 || record.first) ? (
          <View
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 10,
              backgroundColor: colors.card,
            }}
          >
            <Text style={s.muted}>
              {images.length > 1
                ? `${images.length} 张${record.first ? " · 第一次" : ""}`
                : "第一次"}
            </Text>
          </View>
        ) : null}
      </View>
      <View
        style={tileSize ? s.galleryCaption : { flex: 1, minWidth: 0, gap: 4 }}
      >
        {!tileSize && (
          <Text style={s.muted}>
            {dateLabel(record.date)}
            {record.first ? " · 第一次" : ""}
          </Text>
        )}
        <Text
          numberOfLines={tileSize ? 2 : 3}
          style={tileSize && !large ? s.galleryTitle : s.heading}
        >
          {title}
        </Text>
        {!!caption && (
          <Text numberOfLines={tileSize ? 1 : 2} style={s.muted}>
            {caption}
          </Text>
        )}
        {!tileSize && record.mediaIds.length > 0 && (
          <Text style={s.muted}>
            {images.length
              ? `${images.length} 张照片`
              : `${record.mediaIds.length} 份素材`}
          </Text>
        )}
      </View>
      {selected !== undefined && (
        <Text style={{ color: colors.accent, width: 24 }}>
          {selected ? "●" : "○"}
        </Text>
      )}
    </Pressable>
  );
}

export function CaptureDock() {
  const store = useStore(),
    nav = useNav();
  const tabBarHeight = useBottomTabBarHeight();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 20,
        right: 20,
        bottom: tabBarHeight + 12,
        gap: 8,
        alignItems: "flex-end",
      }}
    >
      <ErrorText message={error} />
      <Button
        title="记一刻"
        icon="plus"
        primary
        compact
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
  );
}

export function Timeline() {
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles(),
    { colors, large } = useTheme();
  const tabBarHeight = useBottomTabBarHeight(),
    insets = useSafeAreaInsets(),
    { width, fontScale } = useWindowDimensions();
  const columns = large || fontScale >= 1.4 ? 1 : width >= 600 ? 3 : 2;
  const tileSize =
    (width - insets.left - insets.right - 40 - 12 * (columns - 1)) / columns;
  const [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [month, setMonth] = useState(""),
    [first, setFirst] = useState(false),
    [draftsOpen, setDraftsOpen] = useState(false),
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
  const byDay = new Map<string, LocalRecord[]>();
  for (const record of visible) {
    const day = dateLabel(record.date);
    const group = byDay.get(day) ?? [];
    group.push(record);
    byDay.set(day, group);
  }
  const sections = [...byDay].map(([title, dayRecords]) => {
    const data: LocalRecord[][] = [];
    for (let i = 0; i < dayRecords.length; i += columns)
      data.push(dayRecords.slice(i, i + columns));
    return { title, count: dayRecords.length, data };
  });
  const drafts = Object.values(state.drafts).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const latestDraft = drafts[0];
  return (
    <Page scroll={false} top>
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.map((r) => r.id).join("/")}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: tabBarHeight + 84,
        }}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 12 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.title} numberOfLines={2}>
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
              <IconButton
                label="搜索记录"
                icon="search"
                selected={searchOpen}
                onPress={() => setSearchOpen(!searchOpen)}
              />
              <Button
                title="选择"
                compact
                testID="timeline-select"
                onPress={() => {
                  void beginSelection(store)
                    .then((sessionId) => nav.navigate("Picker", { sessionId }))
                    .catch((e) => setError(messageOf(e)));
                }}
              />
            </View>
            {(searchOpen || !!query) && (
              <Field
                label="搜索记录"
                hideLabel
                placeholder="搜索标题、内容或地点"
                value={query}
                onChangeText={setQuery}
                testID="record-search"
                returnKeyType="search"
              />
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={s.row}>
                <Button
                  title="全部月份"
                  compact
                  selected={!month}
                  onPress={() => setMonth("")}
                />
                {months.map((m) => (
                  <Button
                    key={m}
                    title={m}
                    compact
                    selected={month === m}
                    onPress={() => setMonth(m)}
                  />
                ))}
                <Button
                  title="第一次"
                  compact
                  selected={first}
                  onPress={() => setFirst(!first)}
                />
              </View>
            </ScrollView>
            {latestDraft && (
              <View style={s.compactPanel}>
                <View style={s.between}>
                  <Text style={s.muted}>{drafts.length} 份草稿</Text>
                  <View style={s.row}>
                    <Button
                      title="继续编辑"
                      compact
                      testID={`resume-${latestDraft.id}`}
                      onPress={() =>
                        nav.navigate("Editor", { draftId: latestDraft.id })
                      }
                    />
                    {drafts.length > 1 && (
                      <IconButton
                        label={draftsOpen ? "收起其他草稿" : "查看其他草稿"}
                        icon={draftsOpen ? "close" : "chevron-down"}
                        selected={draftsOpen}
                        onPress={() => setDraftsOpen(!draftsOpen)}
                      />
                    )}
                  </View>
                </View>
                {draftsOpen &&
                  drafts.slice(1).map((draft) => (
                    <Pressable
                      key={draft.id}
                      testID={`resume-${draft.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`继续编辑：${recordTitle(draft.content)}`}
                      onPress={() =>
                        nav.navigate("Editor", { draftId: draft.id })
                      }
                      style={{
                        minHeight: 44,
                        justifyContent: "center",
                        gap: 2,
                      }}
                    >
                      <Text numberOfLines={1}>
                        {recordTitle(draft.content)}
                      </Text>
                      <Text style={s.muted}>
                        {dateLabel(draft.updatedAt)} ·{" "}
                        {draft.content.mediaIds.length} 份素材
                      </Text>
                    </Pressable>
                  ))}
              </View>
            )}
            <ErrorText message={error} />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={s.dateHeading}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={{
                  width: 4,
                  height: 16,
                  borderRadius: 2,
                  backgroundColor: colors.accent,
                }}
              />
              <Text style={s.galleryTitle}>{section.title}</Text>
            </View>
            <Text style={s.muted}>{section.count} 条</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={columns === 1 ? undefined : s.galleryRow}>
            {item.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                tileSize={columns === 1 ? undefined : tileSize}
                onPress={() => nav.navigate("Record", { id: record.id })}
              />
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.heading}>
              {records.length ? "没有找到这段记录" : "把今天的小事留下来"}
            </Text>
            <Text style={s.muted}>
              {records.length
                ? "试试其他关键词或月份。"
                : "点「记一刻」，写几句话，留一张照片。"}
            </Text>
          </View>
        }
      />
      <CaptureDock />
    </Page>
  );
}
