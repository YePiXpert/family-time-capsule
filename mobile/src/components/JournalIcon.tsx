import Svg, { Path, Rect, Circle } from "react-native-svg";

export function JournalIcon({ name, color, size = 24 }: { name: "growth" | "book" | "person" | "plus"; color: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
    {name === "growth" ? <><Path d="M12 21v-9C12 5 7 3 3 3c0 6 3 10 9 10M12 17c0-6 4-9 9-9 0 6-3 10-9 10" /></> : null}
    {name === "book" ? <><Rect x={4} y={3} width={16} height={18} rx={3} /><Path d="M8 3v18M12 8h4M12 12h3" /></> : null}
    {name === "person" ? <><Circle cx={12} cy={8} r={4} /><Path d="M4 21v-2a8 8 0 0 1 16 0v2" /></> : null}
    {name === "plus" ? <Path d="M12 5v14M5 12h14" /> : null}
  </Svg>;
}
