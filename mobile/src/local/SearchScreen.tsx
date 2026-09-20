import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useLibrary } from "./context";
import { sortedRecords } from "./model";
import { useNav, type Props } from "./navigation";
import { searchRecords, type MediaFilter } from "./search";
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
    [person, setPerson] = useState("");
  const { records: recordMap, media: mediaMap, persons: personMap } = state;
  const { results, years, persons } = useMemo(() => {
    const all = sortedRecords({ records: recordMap });
    const kinds = Object.fromEntries(
      Object.values(mediaMap).map((m) => [m.id, m.kind] as const),
    );
    return {
      results: searchRecords(
        all,
        query,
        {
          first,
          quote,
          media,
          year: year || undefined,
          person: person || undefined,
        },
        kinds,
      ),
      years: [...new Set(all.map((r) => r.date.slice(0, 4)))].sort((a, b) =>
        b.localeCompare(a),
      ),
      persons: Object.values(personMap).sort((a, b) =>
        a.name.localeCompare(b.name, "zh"),
      ),
    };
  }, [recordMap, mediaMap, personMap, query, first, quote, media, year, person]);
  const filtered =
    query.trim() || first || quote || media !== "any" || !!year || !!person;
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
          data={results}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ gap: 12, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <RecordCard
              record={item}
              onPress={() => nav.navigate("Record", { id: item.id })}
            />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.heading}>
                {filtered ? "没有找到匹配的记录" : "写下第一段时光"}
              </Text>
              <Text style={s.muted}>
                {filtered ? "换个关键词，或去掉筛选再试。" : "回到书架，点右下角的记一刻。"}
              </Text>
              <Ornament />
            </View>
          }
        />
      </View>
    </Page>
  );
}
