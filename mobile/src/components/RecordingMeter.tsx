import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "./typography";
import { useColorTheme } from "../theme";
import { journalRadius, journalSpace, journalType } from "../design/tokens";
import { useAccessibleEffects } from "../design/use-effects";

export function RecordingMeter({ read }: { read: () => { metering?: number; durationMillis?: number } | undefined }) {
  const { reducedMotion } = useAccessibleEffects();
  const { colors } = useColorTheme();
  const [samples, setSamples] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      try {
        const status = read();
        setSeconds(Math.floor((status?.durationMillis ?? 0) / 1000));
        if (!reducedMotion && typeof status?.metering === "number") setSamples(values => [...values.slice(-23), Math.max(3, Math.min(32, (status.metering! + 60) / 60 * 32))]);
      } catch { /* Recorder teardown must never interrupt a saved recording. */ }
    }, reducedMotion ? 1000 : 150);
    return () => clearInterval(timer);
  }, [read, reducedMotion]);
  return <View style={[styles.meter, { backgroundColor: colors.softCoral, borderColor: colors.peach }]}>
    <Text style={[styles.label, { color: colors.coralDark }]}>正在录音 · {seconds} 秒</Text>
    {!reducedMotion ? <View accessible={false} style={styles.bars}>{samples.map((height, index) => <View key={index} style={{ width: 5, height, borderRadius: 3, backgroundColor: colors.coral }} />)}</View> : null}
    <Text style={[styles.hint, { color: colors.coralDark }]}>说完后点“完成录音”，留下这段原声。</Text>
  </View>;
}

const styles = StyleSheet.create({
  meter: { alignItems: "center", borderRadius: journalRadius.control, borderWidth: 1, gap: journalSpace.small, padding: journalSpace.medium },
  label: { fontSize: journalType.label, fontWeight: "700" },
  bars: { height: 40, flexDirection: "row", alignItems: "center", gap: 4 },
  hint: { fontSize: journalType.caption },
});
