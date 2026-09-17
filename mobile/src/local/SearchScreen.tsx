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
    [media, setMedia] = useState<MediaFilter>("any"),
    [year, setYear] = useState("");
  const { results, years } = useMemo(() => {
    const all = sortedRecords(state);
    const kinds = Object.fromEntries(
      Object.values(state.media).map((m) => [m.id, m.kind] as const),
    );
    return {
      results: searchRecords(
        all,
        query,
        { first, media, year: year || undefined },
        kinds,
      ),
      years: [...new Set(all.map((r) => r.date.slice(0, 4)))].sort((a, b) =>
        b.localeCompare(a),
      ),
    };
  }, [state, query, first, media, year]);
  const filtered = query.trim() || first || media !== "any" || !!year;
  return (
    <Page scroll={false}>
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
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
        data={[
          ...years.map((y) => ({
            key: `y-${y}`,
            title: `${y} 年`,
            active: year === y,
          })),
          { key: "f-first", title: "第一次", active: first },
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
              } else if (item.key === "f-first") setFirst(!first);
              else if (item.key === "m-av")
                setMedia(media === "av" ? "any" : "av");
              else setMedia(media === "none" ? "any" : "none");
            }}
          />
        )}
      />
      <FlatList
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
              {filtered ? "换个关键词，或去掉筛选再试。" : "回到书架，点右下角的笔记下这一刻。"}
            </Text>
            <Ornament />
          </View>
        }
      />
    </Page>
  );
}
