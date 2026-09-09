import Svg, { Path, Rect, Circle } from "react-native-svg";

export function JournalIcon({ name, color, size = 24 }: { name: "growth" | "book" | "person" | "plus" | "image" | "camera" | "microphone" | "file"; color: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
    {name === "growth" ? <><Path d="M12 21v-9C12 5 7 3 3 3c0 6 3 10 9 10M12 17c0-6 4-9 9-9 0 6-3 10-9 10" /></> : null}
    {name === "book" ? <><Rect x={4} y={3} width={16} height={18} rx={3} /><Path d="M8 3v18M12 8h4M12 12h3" /></> : null}
    {name === "person" ? <><Circle cx={12} cy={8} r={4} /><Path d="M4 21v-2a8 8 0 0 1 16 0v2" /></> : null}
    {name === "image" ? <><Rect x={3} y={4} width={18} height={16} rx={2} /><Circle cx={9} cy={9} r={2} /><Path d="m4 17 5-5 3 3 2-2 6 6" /></> : null}
    {name === "camera" ? <><Path d="M8 5l1.5-2h5L16 5h4a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1z" /><Circle cx={12} cy={12} r={4} /></> : null}
    {name === "microphone" ? <><Rect x={8.5} y={3} width={7} height={12} rx={3.5} /><Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" /></> : null}
    {name === "file" ? <><Path d="M5 3h9l5 5v13H5zM14 3v5h5M9 12h6M9 16h6" /></> : null}
    {name === "plus" ? <Path d="M12 5v14M5 12h14" /> : null}
  </Svg>;
}
