import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { fetchBookReview, mutateBookReview, mutateBook } from "../api/client";
import { useApp } from "../state/AppContext";
import { sharedStyles as s } from "../theme";
import { calendarDate } from "../utils/calendar";
import {
  BOOK_TEMPLATES,
  type BookAudience,
  type BookTemplate,
} from "../books/types";
import {
  bookReviewRange,
  earlyBookRanges,
  type BookReview,
  type BookReviewKind,
  type BookReviewRange,
} from "../books/review-types";
import type { RootStackParamList } from "../navigation/types";
export function BookReviewScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "BookReview">) {
  const { credentials, family } = useApp(),
    [range, setRange] = useState(() =>
      bookReviewRange(
        calendarDate(new Date(), family?.timezone ?? "UTC").slice(0, 7),
      ),
    );
  const [start, setStart] = useState(range.startDate),
    [end, setEnd] = useState(range.endDate),
    [period, setPeriod] = useState(range.startDate.slice(0, 7)),
    [kind, setKind] = useState<BookReviewKind>("memory"),
    [audience, setAudience] = useState<BookAudience>("family"),
    [template, setTemplate] = useState<BookTemplate>("growth"),
    [data, setData] = useState<BookReview | null>(null),
    [selected, setSelected] = useState<
      {
        kind: BookReviewKind;
        id: string;
      }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(
    async (cursor = "") => {
      if (!credentials) return;
      const mine = ++generation.current;
      try {
        const next = await fetchBookReview(credentials, {
          ...range,
          kind,
          audience,
          template,
          cursor,
        });
        if (mine !== generation.current) return;
        setData((old) =>
          cursor && old
            ? { ...next, materials: [...old.materials, ...next.materials] }
            : next,
        );
        setError("");
      } catch (e) {
        if (mine === generation.current) setError((e as Error).message);
      }
    },
    [credentials, range, kind, audience, template],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );
  function apply(next: BookReviewRange) {
    setRange(next);
    setStart(next.startDate);
    setEnd(next.endDate);
    setPeriod(next.startDate.slice(0,7));
    setSelected([]);
    setData(null);
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function create(operation: "draft" | "album") {
    if (!credentials) return;
    void perform(async () => {
      const result = await mutateBookReview(credentials, {
        ...range,
        audience,
        template,
        operation,
        ...(selected.length ? { selection: selected } : {}),
      });
      if (result.id)
        navigation.navigate(
          operation === "album" ? "CollectionDetail" : "BookDetail",
          { id: result.id },
        );
    });
  }
  function input(
    label: string,
    value: string,
    onChangeText: (v: string) => void,
  ) {
    return (
      <View>
        <Text style={s.label}>{label}</Text>
        <TextInput
          accessibilityLabel={label}
          style={s.input}
          value={value}
          onChangeText={onChangeText}
          editable={!busy}
          autoCapitalize="none"
        />
      </View>
    );
  }
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.title}>月度与年度回顾</Text>
      <Text style={s.body}>
        用原话和已有素材整理。统计按家庭发生日期，空月份如实留白。
      </Text>
      <View style={s.card}>
        {input("月份或年份（YYYY-MM / YYYY）", period, setPeriod)}
        {
          <Button
            title={"查看月份或全年"}
            onPress={() => {
              try {
                apply(bookReviewRange(period));
              } catch {
                setError("请填写有效月份或四位年份。");
              }
            }}
            disabled={busy}
          />
        }
        {input("开始日期（YYYY-MM-DD）", start, setStart)}
        {input("结束日期（含当天）", end, setEnd)}
        {
          <Button
            title={"查看日期范围"}
            onPress={() => apply({ startDate: start, endDate: end })}
            disabled={busy}
          />
        }
      </View>
      {data?.birthDate ? (
        <View style={s.card}>
          {earlyBookRanges(data.birthDate).map((r) => (
            <View key={r.label}>
              {
                <Button
                  title={r.label}
                  onPress={() =>
                    apply({ startDate: r.startDate, endDate: r.endDate })
                  }
                  disabled={busy}
                />
              }
            </View>
          ))}
        </View>
      ) : null}
      <View style={s.card}>
        {
          <Button
            title={
              audience === "family"
                ? "读者：家庭可读"
                : "读者：当前用户私人阅读"
            }
            onPress={() => {
              setAudience(audience === "family" ? "personal" : "family");
              setSelected([]);
              setData(null);
            }}
            disabled={busy}
          />
        }
        {BOOK_TEMPLATES.map((t) => (
          <View key={t.id}>
            {
              <Button
                title={`${template === t.id ? "✓ " : ""}${t.title}`}
                onPress={() => {
                  setTemplate(t.id);
                  setData(null);
                }}
                disabled={busy}
              />
            }
          </View>
        ))}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      {
        <Button
          title={"刷新回顾"}
          onPress={() => void load()}
          disabled={busy}
        />
      }
      {data ? (
        <>
          <Text style={s.cardTitle}>
            {range.startDate} 至 {range.endDate}
          </Text>
          <Text style={s.body}>
            {data.total} 段记忆 · 人工精选 {data.selectedCount} 段 ·{" "}
            {data.timezone}
          </Text>
          {data.months.map((m) => (
            <Text key={m.month} style={s.body}>
              {m.month} · {m.count ? `${m.count} 段记忆` : "暂无记忆，留白"}
            </Text>
          ))}
          {data.draft ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>正在制作：{data.draft.title}</Text>
              <Text style={s.body}>
                还有 {data.draft.newMemoryCount}{" "}
                段记忆尚未选入。已有人工编辑不会自动改写。
              </Text>
              {
                <Button
                  title={"继续编辑草稿"}
                  onPress={() =>
                    navigation.navigate("BookDetail", { id: data.draft!.id })
                  }
                  disabled={busy}
                />
              }
            </View>
          ) : null}
          {(
            [
              ["memory", "记忆与成长节点"],
              ["contribution", "家人讲述"],
              ["story", "已发布周记与故事"],
            ] as const
          ).map(([value, label]) => (
            <View key={value}>
              {
                <Button
                  title={`${kind === value ? "✓ " : ""}${label}`}
                  onPress={() => {
                    setKind(value);
                    setData(null);
                  }}
                  disabled={busy}
                />
              }
            </View>
          ))}
          {!data.materials.length ? (
            <Text style={s.body}>当前范围没有可见的此类素材。</Text>
          ) : null}
          {data.materials.map((m) => (
            <View key={`${m.kind}:${m.id}`} style={s.card}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={m.title}
                accessibilityState={{
                  checked: selected.some(
                    (s) => s.kind === m.kind && s.id === m.id,
                  ),
                }}
                disabled={busy || !data.canWrite}
                style={s.secondaryButton}
                onPress={() =>
                  setSelected((old) =>
                    old.some((s) => s.kind === m.kind && s.id === m.id)
                      ? old.filter((s) => s.kind !== m.kind || s.id !== m.id)
                      : [...old, { kind: m.kind, id: m.id }],
                  )
                }
              >
                <Text style={s.secondaryText}>
                  {selected.some((s) => s.kind === m.kind && s.id === m.id)
                    ? "✓ "
                    : ""}
                  {m.title}
                </Text>
              </Pressable>
              <Text style={s.body}>
                {m.date}
                {m.author ? ` · ${m.author}` : ""}
                {m.milestone ? ` · 成长节点：${m.milestone}` : ""}
                {m.included ? " · 已在草稿中" : ""}
              </Text>
              {m.kind === "memory" ? (
                <>
                  {
                    <Button
                      title={"原始记忆"}
                      onPress={() =>
                        navigation.navigate("Memory", { id: m.id })
                      }
                      disabled={busy}
                    />
                  }
                  {data.canWrite ? (
                    <Button
                      title={m.selected ? "取消人工精选" : "设为人工精选"}
                      onPress={() =>
                        void perform(async () => {
                          await mutateBookReview(credentials!, {
                            ...range,
                            audience,
                            template,
                            operation: "highlight",
                            id: m.id,
                            selected: !m.selected,
                          });
                          await load();
                        })
                      }
                      disabled={busy}
                    />
                  ) : null}
                </>
              ) : m.kind === "story" ? (
                <Button
                  title={"来源故事"}
                  onPress={() =>
                    navigation.navigate("StoryDetail", { id: m.id })
                  }
                  disabled={busy}
                />
              ) : null}
            </View>
          ))}
          {data.nextCursor ? (
            <Button
              title={"更多回顾素材"}
              onPress={() => void load(data.nextCursor!)}
              disabled={busy}
            />
          ) : null}
          {data.canWrite ? (
            <View style={s.card}>
              <Text style={s.body}>
                已勾选 {selected.length}{" "}
                项。未勾选时用人工精选，没有精选则使用当前范围记忆（最多 100
                项）。
              </Text>
              <Text style={s.body}>
                重复建立恢复同一未完成草稿；需要另一本时，在作品页明确复制。
              </Text>
              {
                <Button
                  title={data.draft ? "恢复同一草稿" : "建立可编辑年册草稿"}
                  onPress={() => create("draft")}
                  disabled={busy}
                />
              }
              {
                <Button
                  title={"建立相册草稿"}
                  onPress={() => create("album")}
                  disabled={busy || selected.some((s) => s.kind !== "memory")}
                />
              }
              {data.draft && selected.length ? (
                <Button
                  title={"将所选加入现有草稿"}
                  onPress={() =>
                    void perform(async () => {
                      await mutateBook(credentials!, data.draft!.id, {
                        operation: "add",
                        revision: data.draft!.revision,
                        selection: selected,
                      });
                      setSelected([]);
                      await load();
                    })
                  }
                  disabled={busy}
                />
              ) : null}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={s.body}>正在读取回顾…</Text>
      )}
    </ScrollView>
  );
}

function Button({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[s.secondaryButton, disabled && s.disabled]}
      onPress={onPress}
    >
      <Text style={s.secondaryText}>{title}</Text>
    </Pressable>
  );
}
