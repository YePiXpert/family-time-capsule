import { useMemo, useState } from "react";
import { View } from "react-native";
import { getRandomBytes } from "expo-crypto";
import { Button, Card, ErrorText, FieldRow, Text, useStyles } from "../local/ui";
/** 从 12 个位置里随机挑 3 个、按顺序排好（随机只取 expo-crypto）。 */
export function checkPositions(random: (n: number) => Uint8Array = getRandomBytes): number[] {
  const picked = new Set<number>();
  while (picked.size < 3) for (const b of random(8)) if (picked.size < 3 && b < 252) picked.add(b % 12);
  return [...picked].sort((a, b) => a - b);
}
/** 核对抄下的词：大小写与首尾空格不算错。返回第一处不对的位置，全对返回 null。 */
export function firstWrong(words: string[], positions: number[], typed: string[]): number | null {
  for (const [i, at] of positions.entries())
    if ((typed[i] ?? "").trim().toLowerCase() !== words[at]) return at;
  return null;
}
/**
 * 新恢复码：先摆出 12 个词让管理者抄在纸上，再随机抽 3 个核对，核对过才算完成。
 * 这是唯一一次能看到它；离开这一页就只能重新生成一套。
 */
export function RecoveryWords({ words, onDone }: { words: string; onDone: () => void }) {
  const s = useStyles();
  const list = useMemo(() => words.split(" "), [words]);
  const positions = useMemo(() => checkPositions(), []);
  const [checking, setChecking] = useState(false),
    [typed, setTyped] = useState(["", "", ""]),
    [error, setError] = useState("");
  if (!checking)
    return (
      <Card testID="family-words">
        <Text style={s.heading}>家庭恢复码</Text>
        <Text style={s.muted}>
          请把这 12 个词抄在纸上，放在家里安全的地方。所有管理者的手机都丢了时，凭它把家庭找回来。不要截图，不要发到聊天里；这一页离开后就再也看不到了。
        </Text>
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12 }}
          accessibilityLabel={`恢复码：${list.map((w, i) => `第 ${i + 1} 个 ${w}`).join("，")}`}
        >
          {list.map((word, i) => (
            <View key={i} style={{ width: "33.33%", flexDirection: "row", gap: 6 }}>
              <Text style={s.muted}>{String(i + 1).padStart(2, " ")}</Text>
              <Text style={{ fontWeight: "600" }}>{word}</Text>
            </View>
          ))}
        </View>
        <Text style={s.footnote}>恢复码不是备份：它能解开远端已有的内容，变不出远端没有的。定期导出完整备份照旧要做。</Text>
        <Button title="我已抄在纸上" primary testID="family-words-written" onPress={() => setChecking(true)} />
      </Card>
    );
  return (
    <Card testID="family-words-check">
      <Text style={s.heading}>核对一下</Text>
      <Text style={s.muted}>照着纸上抄的，填出下面这 3 个词。</Text>
      <View>
        {positions.map((at, i) => (
          <FieldRow
            key={at}
            label={`第 ${at + 1} 个`}
            value={typed[i]}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            testID={`family-words-check-${i}`}
            onChangeText={(text) => {
              setError("");
              setTyped(typed.map((t, j) => (j === i ? text : t)));
            }}
            last={i === positions.length - 1}
          />
        ))}
      </View>
      <ErrorText message={error} />
      <View style={s.row}>
        <Button
          title="核对"
          primary
          testID="family-words-verify"
          disabled={typed.some((t) => !t.trim())}
          onPress={() => {
            const wrong = firstWrong(list, positions, typed);
            if (wrong === null) onDone();
            else setError(`第 ${wrong + 1} 个词不对。回去再看一眼纸上抄的。`);
          }}
        />
        <Button title="回去再看" kind="text" onPress={() => setChecking(false)} />
      </View>
    </Card>
  );
}
