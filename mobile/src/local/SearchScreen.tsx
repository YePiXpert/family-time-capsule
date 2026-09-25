import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useLibrary } from "./context";
import { sortedRecords, yearKey } from "./model";
import { useNav, type Props } from "./navigation";
import { SEARCH_LIMIT, searchSortedRecords, type MediaFilter } from "./search";
import { RecordCard } from "./Home";
import {
  Button,
  Field,
  Ornament,
  Page,
  Text,
  useStyles,
} from "./ui";

export function SearchScreen(_: Props<"Search">) {
  const state = useLibrary(),
    nav = useNav(),
    s = useStyles();
  const [query, setQuery] = useState(""),
    [first, setFirst] = useState(false),
    [quote, setQuote] = useState(false),
    [media, setMedia] = useState<MediaFilter>("any"),
    [year, setYear] = useState(""),
    [person, setPerson] = useState(""),
    [by, setBy] = useState("");
  const { records: recordMap, media: mediaMap, persons: personMap } = state;
  // 排序、年份与落款只跟着记录变；每敲一个字只重跑下面那趟检索（一万段时整库重排要几十毫秒）。
  const all = sortedRecords({ records: recordMap });
  const { years, writers } = useMemo(() => {
    const byCount = new Map<string, number>();
    for (const r of all) if (r.by) byCount.set(r.by, (byCount.get(r.by) ?? 0) + 1);
    return {
      // 与筛选同一口径按本地年份：UTC+8 元旦凌晨的记录不能挂到上一年的标签下。
      years: [...new Set(all.map((r) => yearKey(r.date)))].sort((a, b) =>
        b.localeCompare(a),
      ),
      writers: [...byCount.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
        .map(([name]) => name),
    };
  }, [all]);
  const kinds = useMemo(
    () =>
      Object.fromEntries(
        Object.values(mediaMap).map((m) => [m.id, m.kind] as const),
      ),
    [mediaMap],
  );
  const persons = useMemo(
    () =>
      Object.values(personMap).sort((a, b) =>
        a.name.localeCompare(b.name, "zh"),
      ),
    [personMap],
  );
  const found = useMemo(
    () =>
      // 多取一条，才知道是不是还有更早的没列出来。
      searchSortedRecords(
        all,
        query,
        {
          first,
          quote,
          media,
          year: year || undefined,
          person: person || undefined,
          by: by || undefined,
        },
        kinds,
        SEARCH_LIMIT + 1,
      ),
    [all, kinds, query, first, quote, media, year, person, by],
  );
  const more = found.length > SEARCH_LIMIT;
  const results = more ? found.slice(0, SEARCH_LIMIT) : found;
  const filtered =
    query.trim() ||
    first ||
    quote ||
    media !== "any" ||
    !!year ||
    !!person ||
    !!by;
  return (
    <Page scroll={false} title="搜索">
      {/* scroll=false 不套 content 边距，这里自行补齐 20 的页面边距。 */}
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 20 }}>
        <Field
          label="搜索全部记录"
          hideLabel
          testID="global-search"
          placeholder="搜索标题、内容或地点"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoFocus
        />
        <FlatList
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          data={[
            ...years.map((y) => ({
              key: `y-${y}`,
              title: `${y} 年`,
              active: year === y,
            })),
            ...persons.map((p) => ({
              key: `p-${p.id}`,
              title: p.name,
              active: person === p.id,
            })),
            ...writers.map((name) => ({
              key: `b-${name}`,
              title: `${name}写的`,
              active: by === name,
            })),
            { key: "f-first", title: "第一次", active: first },
            { key: "f-quote", title: "她说的话", active: quote },
            { key: "m-av", title: "有声像", active: media === "av" },
            { key: "m-none", title: "纯文字", active: media === "none" },
          ]}
          keyExtractor={(chip) => chip.key}
          renderItem={({ item }) => (
            <Button
              compact
              title={item.title}
              selected={item.active}
              onPress={() => {
                if (item.key.startsWith("y-")) {
                  const y = item.key.slice(2);
                  setYear(year === y ? "" : y);
                } else if (item.key.startsWith("p-")) {
                  const p = item.key.slice(2);
                  setPerson(person === p ? "" : p);
                } else if (item.key.startsWith("b-")) {
                  const name = item.key.slice(2);
                  setBy(by === name ? "" : name);
                } else if (item.key === "f-first") setFirst(!first);
                else if (item.key === "f-quote") setQuote(!quote);
                else if (item.key === "m-av")
                  setMedia(media === "av" ? "any" : "av");
                else setMedia(media === "none" ? "any" : "none");
              }}
            />
          )}
        />
        <FlatList
          // 搜索框 autoFocus，键盘一直在：不放行的话点筛选或结果的第一下只会收键盘。
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          alwaysBounceVertical={false}
          data={results}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ gap: 12, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <RecordCard
              record={item}
              onPress={() => nav.navigate("Record", { id: item.id })}
            />
          )}
          ListFooterComponent={
            more ? (
              <Text style={[s.muted, { textAlign: "center" }]}>
                {`只列出最近的 ${SEARCH_LIMIT} 段。选个年份或加一项筛选，能看到更早的。`}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.heading}>
                {filtered ? "没有找到匹配的记录" : "写下第一段时光"}
              </Text>
              <Text style={s.muted}>
                {filtered ? "换个关键词，或去掉筛选再试。" : "回到书架，点右下角的「记一刻」。"}
              </Text>
              <Ornament />
            </View>
          }
        />
      </View>
    </Page>
  );
}
