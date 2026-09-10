import Svg, { Circle, Path, Rect } from "react-native-svg";

export type JournalIconName =
  | "growth" | "book" | "person" | "plus" | "image" | "camera" | "microphone" | "file"
  | "settings" | "search" | "calendar" | "star" | "play" | "pause" | "check"
  | "chevron-right" | "chevron-down" | "arrow-left" | "trash" | "edit" | "lock"
  | "download" | "close" | "video" | "audio" | "users" | "heart";

/**
 * 统一图标语言：24px 网格、1.8px 描边、圆角端点。
 * 旧八芒星齿轮在小尺寸下像太阳，设置改用滑杆；植物/书/人形重新绘制，保证 22px 可读。
 */
const paths: Record<JournalIconName, React.ReactNode> = {
  growth: <>
    <Path d="M12 21v-7.5" />
    <Path d="M12 13.5C12 9.6 9.1 6.8 4.8 6.8c0 3.9 2.9 6.7 7.2 6.7" />
    <Path d="M12 10.8c0-3.9 2.9-6.8 7.2-6.8 0 3.9-2.9 6.8-7.2 6.8" />
  </>,
  book: <>
    <Path d="M12 5.8C10.2 4.3 7.7 3.8 4.5 3.8v14.9c3.2 0 5.7.5 7.5 2 1.8-1.5 4.3-2 7.5-2V3.8c-3.2 0-5.7.5-7.5 2z" />
    <Path d="M12 5.8v14.9" />
  </>,
  person: <>
    <Circle cx={12} cy={7.6} r={3.4} />
    <Path d="M5.6 20c.8-3.9 3.2-6 6.4-6s5.6 2.1 6.4 6" />
  </>,
  settings: <>
    <Path d="M4 7.2h8.2M16.8 7.2H20" />
    <Circle cx={14.5} cy={7.2} r={2.1} />
    <Path d="M4 12h3.2M11.8 12H20" />
    <Circle cx={9.5} cy={12} r={2.1} />
    <Path d="M4 16.8h9.2M17.8 16.8H20" />
    <Circle cx={15.5} cy={16.8} r={2.1} />
  </>,
  search: <>
    <Circle cx={10.8} cy={10.8} r={6.3} />
    <Path d="m15.7 15.7 4.6 4.6" />
  </>,
  calendar: <>
    <Rect x={4} y={5.5} width={16} height={15} rx={3} />
    <Path d="M4 10.5h16M9 3.5v4M15 3.5v4" />
  </>,
  star: <Path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" />,
  play: <Path d="M8.5 5.8v12.4L19 12z" />,
  pause: <Path d="M9.3 5.8v12.4M14.7 5.8v12.4" />,
  check: <Path d="m5 12.6 4.4 4.4L19 7.4" />,
  "chevron-right": <Path d="m9.5 6 6 6-6 6" />,
  "chevron-down": <Path d="m6 9.5 6 6 6-6" />,
  "arrow-left": <Path d="m10.5 5.5-6.5 6.5 6.5 6.5M4 12h16" />,
  trash: <>
    <Path d="M5 7h14M9.8 7V5h4.4v2M7.2 7l.9 13h7.8l.9-13M10.4 10.8v5M13.6 10.8v5" />
  </>,
  edit: <>
    <Path d="M4.8 19.2l.9-3.8L15.9 5.2l2.9 2.9L8.6 18.3z" />
    <Path d="m14.4 6.7 2.9 2.9" />
  </>,
  lock: <>
    <Rect x={5.8} y={10.5} width={12.4} height={9.7} rx={2.6} />
    <Path d="M8.8 10.5V7.7a3.2 3.2 0 0 1 6.4 0v2.8" />
  </>,
  download: <Path d="M12 4v10.2M8 10.3l4 4 4-4M5 19.2h14" />,
  close: <Path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8" />,
  video: <>
    <Rect x={3.5} y={6.5} width={12.8} height={11.5} rx={2.6} />
    <Path d="m16.3 10.6 4.2-2.3v7.4l-4.2-2.3" />
  </>,
  audio: <>
    <Path d="M9.5 17.8V6.5l8.5-2.3v11.2" />
    <Circle cx={7} cy={17.8} r={2.5} />
    <Circle cx={15.5} cy={15.4} r={2.5} />
  </>,
  users: <>
    <Circle cx={9.2} cy={8} r={3.1} />
    <Path d="M3.6 19.6c.7-3.5 2.8-5.4 5.6-5.4s4.9 1.9 5.6 5.4" />
    <Path d="M15.6 5.2a3.1 3.1 0 0 1 0 5.7M17.3 14.5c1.7.8 2.8 2.4 3.1 5.1" />
  </>,
  heart: <Path d="M12 19.8s-7.3-4.6-7.3-9.6A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.3 3c0 5-7.3 9.6-7.3 9.6z" />,
  image: <>
    <Rect x={3.5} y={4.5} width={17} height={15} rx={2.6} />
    <Circle cx={9} cy={9.4} r={1.8} />
    <Path d="m4.5 16.6 4.6-4.6 2.8 2.8 2.1-2.1 5.5 5.5" />
  </>,
  camera: <>
    <Path d="M9 6.8 10.3 4.8h3.4L15 6.8h4.4a1.6 1.6 0 0 1 1.6 1.6v10.4a1.6 1.6 0 0 1-1.6 1.6H4.6a1.6 1.6 0 0 1-1.6-1.6V8.4a1.6 1.6 0 0 1 1.6-1.6z" />
    <Circle cx={12} cy={13.2} r={3.6} />
  </>,
  microphone: <>
    <Rect x={8.6} y={3.2} width={6.8} height={11.4} rx={3.4} />
    <Path d="M5.8 11.4a6.2 6.2 0 0 0 12.4 0M12 17.6v3.2M9.2 20.8h5.6" />
  </>,
  file: <>
    <Path d="M6 3.8h7.5L18.5 9v11.2H6zM13.2 3.8V9h5.3M9.2 12.6h5.6M9.2 16h5.6" />
  </>,
  plus: <Path d="M12 5.6v12.8M5.6 12h12.8" />,
};

export function JournalIcon({ name, color, size = 24 }: { name: JournalIconName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      {paths[name]}
    </Svg>
  );
}
