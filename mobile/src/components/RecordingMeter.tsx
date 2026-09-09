import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "./typography";
import { colors, sharedStyles } from "../theme";
import { useAccessibleEffects } from "../design/use-effects";

export function RecordingMeter({ read }: { read: () => { metering?: number; durationMillis?: number } | undefined }) {
  const { reducedMotion } = useAccessibleEffects();
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
  return <View style={sharedStyles.notice}>
    <Text style={sharedStyles.label}>正在录音 · {seconds} 秒</Text>
    {!reducedMotion ? <View accessible={false} style={{ height: 40, flexDirection: "row", alignItems: "center", gap: 4 }}>{samples.map((height, index) => <View key={index} style={{ width: 5, height, borderRadius: 3, backgroundColor: colors.coral }} />)}</View> : null}
    <Text style={sharedStyles.body}>说完后点“完成录音”，留下这段原声。</Text>
  </View>;
}
