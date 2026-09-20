import { Pressable, View } from "react-native";
import { useLibrary } from "./context";
import { ageLine } from "./dates";
import { recordTitle, sortedRecords } from "./model";
import { useNav } from "./navigation";
import {
  Button,
  Card,
  Ornament,
  Page,
  Text,
  dateLabel,
  serif,
  useStyles,
  useTheme,
} from "./ui";

/** 语录册引的是正文第一段；正文空着就退回标题。 */
const saidOf = (text: string, fallback: string) =>
  text.trim().split(/\n\s*\n/)[0]?.trim() || fallback;

export function Quotes() {
  const state = useLibrary(),
    s = useStyles(),
    nav = useNav(),
    { colors, large } = useTheme();
  const quotes = sortedRecords(state)
    .filter((r) => r.quote)
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Page title="她说的话">
      <Text style={s.muted}>
        {quotes.length ? `${quotes.length} 句原话，按日子排好。` : ""}
      </Text>
      {quotes.map((record) => {
        const said = saidOf(record.text, recordTitle(record));
        const age = ageLine(state.profile.birthday, new Date(record.date))?.split(
          " · ",
        )[0];
        return (
          <Pressable
            key={record.id}
            testID={`quote-${record.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${said}，${dateLabel(record.date)}`}
            onPress={() => nav.navigate("Record", { id: record.id })}
          >
            <Card>
              <Text
                numberOfLines={8}
                style={{
                  fontFamily: serif,
                  fontSize: large ? 24 : 21,
                  lineHeight: large ? 36 : 32,
                  color: colors.ink,
                }}
              >
                「{said}」
              </Text>
              <Text style={s.muted}>
                {dateLabel(record.date)}
                {age ? ` · ${age}` : ""}
              </Text>
            </Card>
          </Pressable>
        );
      })}
      {quotes.length === 0 && (
        <View style={s.empty}>
          <Text style={s.heading}>还没有收下她的话</Text>
          <Text style={s.muted}>
            在阅读页点亮「她说的话」，那句原话就会收进这一册。
          </Text>
          <View style={s.row}>
            <Button title="回书架" kind="text" onPress={() => nav.goBack()} />
          </View>
          <Ornament />
        </View>
      )}
    </Page>
  );
}
