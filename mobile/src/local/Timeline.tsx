import { useMemo, useState } from "react";
import { Pressable, SectionList, View } from "react-native";
import { useLibrary, useStore, useSyncStatus } from "./context";
import {
  sortedRecords,
  monthKey,
  recordTitle,
  type LocalRecord,
  type Stored,
} from "./model";
import { beginDraft, beginLetter } from "./services";
import { useFocusGuard, useNav } from "./navigation";
import {
  Button,
  Card,
  ErrorText,
  IconButton,
  Page,
  Photo,
  Text,
  dateLabel,
  messageOf,
  monthLabel,
  useStyles,
  useTheme,
} from "./ui";
import { CaptureFab } from "./CaptureFab";
import { isEmptyDraft } from "./empties";
import { dailyPromptOf } from "./prompts";
import { letterCaption, sortLetters } from "./letters";
import { pickAnother } from "./shuffle";

export function TimelineCard({ record }: { record: Stored<LocalRecord> }) {
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles();
  const media = record.mediaIds
    .map((id) => state.media[id])
    .find((m) => m?.kind === "image" || m?.kind === "video");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${dateLabel(record.date)}，${record.by || "家人"}，${recordTitle(record)}`}
      testID={`record-${record.id}`}
      onPress={() => nav.navigate("Record", { id: record.id })}
    >
      <Card>
        <Text style={s.muted}>
          {dateLabel(record.date)} · {record.by || "家人"}
          {record.first ? " · 第一次" : ""}
          {record.quote ? " · 她说的话" : ""}
        </Text>
        {!!record.title && <Text style={s.heading}>{record.title}</Text>}
        {!!record.text && <Text numberOfLines={4}>{record.text}</Text>}
        {media && (
          <Photo
            media={media}
            preview
            ratio={4 / 3}
            label={media.kind === "video" ? "视频预览" : "照片预览"}
          />
        )}
        {!!record.mediaIds.length && (
          <Text style={s.muted}>
            {record.mediaIds
              .map((id) => state.media[id]?.kind)
              .includes("audio")
              ? "含录音 · "
              : ""}
            {record.mediaIds.length} 个附件
          </Text>
        )}
      </Card>
    </Pressable>
  );
}
export function Timeline() {
  const state = useLibrary(),
    nav = useNav(),
    store = useStore(),
    s = useStyles(),
    { colors } = useTheme();
  const sync = useSyncStatus();
  const guard = useFocusGuard();
  const [error, setError] = useState("");
  const records = sortedRecords(state);
  const sections = useMemo(() => {
    const months = new Map<string, Stored<LocalRecord>[]>();
    for (const r of records) {
      const key = monthKey(r.date);
      const list = months.get(key) ?? [];
      list.push(r);
      months.set(key, list);
    }
    return [...months].map(([title, data]) => ({ title, data }));
  }, [records]);
  const drafts = Object.values(state.drafts).filter((d) => !isEmptyDraft(d));
  const today = new Date();
  const memory = records.find((r) => {
    const d = new Date(r.date);
    return (
      d.getFullYear() < today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  });
  const start = () => {
    if (!guard.take()) return;
    void beginDraft(store)
      .then((draftId) => nav.navigate("Editor", { draftId }))
      .catch((e) => {
        guard.release();
        setError(messageOf(e));
      });
  };
  return (
    <Page
      title="时光"
      back={false}
      scroll={false}
      right={
        <IconButton
          icon="settings"
          label="设置"
          testID="open-settings"
          onPress={() => nav.navigate("Settings")}
        />
      }
    >
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 110 }}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 12 }}>
            <Text style={s.title}>{state.profile.name || "我们的"}成长记</Text>
            <View style={s.row}>
              <Button
                title="给未来的信"
                icon="seal"
                testID="timeline-letters"
                onPress={() => nav.navigate("Letters")}
              />
              <Button
                title="回忆"
                icon="calendar"
                testID="timeline-memories"
                onPress={() => nav.navigate("Memories")}
              />
            </View>
            {drafts.map((d) => (
              <Button
                key={d.id}
                testID="draft-continue"
                title={`继续写：${d.content.title || d.content.text.slice(0, 18) || "未完成的记录"}`}
                kind="text"
                onPress={() => nav.navigate("Editor", { draftId: d.id })}
              />
            ))}
            {sync.conflicts > 0 ? (
              <Button
                title="有记录需要一起核对"
                kind="text"
                onPress={() => nav.navigate("Conflicts")}
              />
            ) : memory ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => nav.navigate("Record", { id: memory.id })}
              >
                <Text style={s.muted}>那年今日 · {recordTitle(memory)}</Text>
              </Pressable>
            ) : (
              <Text style={s.muted}>
                {dailyPromptOf(state.profile.birthday, today)}
              </Text>
            )}
            {sync.joined && (
              <Text style={s.muted}>
                {sync.running
                  ? "本机已保存 · 正在同步"
                  : sync.lastError
                    ? "本机已保存 · 联网后再同步"
                    : sync.lastSyncAt
                      ? "已与家人同步 · 附件点开下载"
                      : "本机已保存 · 等待同步"}
              </Text>
            )}
            <ErrorText message={error} />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[s.heading, { color: colors.muted, paddingTop: 12 }]}>
            {monthLabel(section.title)}
          </Text>
        )}
        renderItem={({ item }) => <TimelineCard record={item} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.heading}>从今天的一件小事开始</Text>
            <Text style={s.muted}>写一句、留张照片，或说一段话。</Text>
            <Button title="记一条" onPress={start} />
          </View>
        }
      />
      <CaptureFab />
    </Page>
  );
}
export function Memories() {
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles();
  const records = sortedRecords(state);
  const years = [...new Set(records.map((r) => monthKey(r.date).slice(0, 4)))];
  return (
    <Page title="回忆">
      <Button
        testID="open-search"
        title="搜索过去的记录"
        icon="search"
        onPress={() => nav.navigate("Search")}
      />
      {records.length > 0 && (
        <Button
          title="随便翻翻"
          kind="text"
          onPress={() =>
            nav.navigate("Record", {
              id: pickAnother(records.map((r) => r.id))!,
              shuffle: true,
            })
          }
        />
      )}
      {!records.length && (
        <Text style={s.muted}>记下的小事会在这里慢慢积起来。</Text>
      )}
      {years.map((year) => (
        <Card key={year}>
          <Text style={s.heading}>{year} 年</Text>
          {Number(year) < new Date().getFullYear() && (
            <Button
              title="这一年的成长故事"
              icon="heart"
              onPress={() => nav.navigate("Story", { year })}
            />
          )}
          <View style={s.row}>
            {[
              ...new Set(
                records
                  .filter((r) => monthKey(r.date).startsWith(year))
                  .map((r) => monthKey(r.date)),
              ),
            ].map((month) => (
              <Button
                key={month}
                testID={`volume-${month}`}
                title={`${Number(month.slice(5))} 月`}
                compact
                onPress={() => nav.navigate("Month", { month })}
              />
            ))}
          </View>
        </Card>
      ))}
      {Object.values(state.albums).length > 0 && (
        <Text style={s.heading}>以前的册子</Text>
      )}
      {Object.values(state.albums).map((album) => (
        <Button
          key={album.id}
          title={album.name}
          kind="text"
          onPress={() => nav.navigate("Album", { id: album.id })}
        />
      ))}
      {years.length > 0 && <Text style={s.muted}>旧版册子与纸书</Text>}
      {years.map((year) => (
        <Button
          key={year}
          testID={`volume-year-${year}`}
          title={`${year} 年 · 册子与纸书`}
          kind="text"
          onPress={() => nav.navigate("Year", { year })}
        />
      ))}
      <Button
        title="名字的故事"
        kind="text"
        onPress={() => nav.navigate("Title")}
      />
    </Page>
  );
}
export function LetterInbox() {
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles();
  const guard = useFocusGuard();
  const [error, setError] = useState("");
  return (
    <Page title="给未来的信">
      <Text style={s.muted}>把现在想说的话，留给未来的她。</Text>
      <Button
        title="写一封信"
        primary
        icon="edit"
        testID="letter-new"
        onPress={() => {
          if (!guard.take()) return;
          void beginLetter(store, state.settings.by)
            .then((id) => nav.navigate("LetterEditor", { id }))
            .catch((e) => {
              guard.release();
              setError(messageOf(e));
            });
        }}
      />
      <ErrorText message={error} />
      {sortLetters(Object.values(state.letters)).map((l) => (
        <Pressable
          key={l.id}
          accessibilityRole="button"
          onPress={() =>
            nav.navigate(l.sealed ? "Letter" : "LetterEditor", { id: l.id })
          }
        >
          <Card>
            <Text style={s.heading}>{l.title || "给你的一封信"}</Text>
            <Text style={s.muted}>{letterCaption(l)}</Text>
            <Text style={s.muted}>
              {!l.sealed
                ? "草稿 · 仅这台手机可见"
                : l.visibility === "family"
                  ? "家人现在可读"
                  : "留到约定生日 · 可确认提前拆开"}
            </Text>
          </Card>
        </Pressable>
      ))}
    </Page>
  );
}
