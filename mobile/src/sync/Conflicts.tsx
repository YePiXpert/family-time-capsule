import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useStore } from "../local/context";
import { dateLabel, dateTimeLabel } from "../local/dates";
import type { LocalLetter, LocalRecord } from "../local/model";
import {
  Button,
  Card,
  ErrorText,
  Page,
  Text,
  messageOf,
  useStyles,
  useTheme,
} from "../local/ui";
import { restoreLoser } from "./conflicts";
import { readConflicts, writeConflicts, type Conflict } from "./state";

const newestFirst = (items: Conflict[]) =>
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
export function Conflicts() {
  const store = useStore(),
    s = useStyles(),
    { colors } = useTheme();
  const [items, setItems] = useState<Conflict[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    let live = true;
    void readConflicts()
      .then((next) => {
        if (live) {
          setItems(newestFirst(next));
          setError("");
        }
      })
      .catch((e: unknown) => {
        if (live) setError(messageOf(e));
      });
    return () => { live = false; };
  }, []));
  const resolve = async (conflict: Conflict, restore: boolean) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (restore)
        await store.change((lib) =>
          restoreLoser(lib, conflict, new Date().toISOString()),
        );
      // 重读后只移除选中的留底，保留打开页面后可能新写入的其他冲突。
      const current = await readConflicts();
      writeConflicts(current.filter((item) =>
        JSON.stringify(item) !== JSON.stringify(conflict),
      ));
      setItems(newestFirst(await readConflicts()));
      if (restore) setMessage("已换回这一版。");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title="两台手机都改过" testID="conflicts">
      <ErrorText message={error} />
      {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
      <Text style={s.muted}>
        {items.length === 0
          ? "没有要看的了。两台手机改了同一段时，时间新的一版会留下，另一版收在这里，随时可以换回。"
          : "两台手机改了同一段时光或同一封信。时间新的一版已经留下；下面是另一版，想要就换回来。"}
      </Text>
      {items.map((conflict) => {
        const { loser, winner, entityId, device, kind } = conflict;
        const by = kind === "records"
          ? (loser as LocalRecord).by
          : (loser as LocalLetter).from;
        const who = by || (device ? "另一台手机" : "这台手机");
        return (
          <Card key={conflict.key} testID={`conflict-${entityId}`}>
            <Text style={[s.muted, { color: colors.accent, fontWeight: "600" }]}>
              {kind === "records"
                ? dateLabel((loser as LocalRecord).date)
                : `一封信 · 写于 ${dateLabel((loser as LocalLetter).writtenAt)}`}
            </Text>
            <Text style={s.muted}>{`留下的一版：${winner.deleted ? "已被删掉" : winner.by ?? "家人"} · ${dateTimeLabel(winner.updatedAt)}`}</Text>
            <Text style={s.muted}>{`这一版：${who} · ${dateTimeLabel(loser.updatedAt)}`}</Text>
            {!!loser.title.trim() && <Text style={s.heading}>{loser.title.trim()}</Text>}
            <Text selectable>{loser.text}</Text>
            {!!by && (
              <Text style={[s.muted, { textAlign: "right" }]}>{`—— ${by}`}</Text>
            )}
            <View style={s.row}>
              <Button
                title="用这一版"
                testID={`conflict-use-${entityId}`}
                disabled={busy}
                onPress={() => { void resolve(conflict, true); }}
              />
              <Button
                title="知道了"
                kind="text"
                testID={`conflict-dismiss-${entityId}`}
                disabled={busy}
                onPress={() => { void resolve(conflict, false); }}
              />
            </View>
          </Card>
        );
      })}
    </Page>
  );
}
