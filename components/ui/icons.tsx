import type { SVGProps } from "react";

export type IconName =
  | "home"
  | "timeline"
  | "capture"
  | "inbox"
  | "more"
  | "search"
  | "people"
  | "person"
  | "story"
  | "microphone"
  | "capsule"
  | "book"
  | "settings"
  | "trash"
  | "image"
  | "audio"
  | "video"
  | "upload"
  | "edit"
  | "archive"
  | "chevron-right"
  | "arrow-left"
  | "camera"
  | "lock"
  | "check"
  | "spark"
  | "calendar"
  | "heart";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: IconName;
  size?: number;
};

/*
 * 与移动端 mobile/src/components/JournalIcon.tsx 同一套图标语言：
 * 24px 网格、1.8px 圆角描边。导航「我的」从八芒星齿轮（小尺寸像太阳）改为人形。
 */
const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="M3.5 10.5 12 3l8.5 7.5"/><path d="M5.5 9.5v10h13v-10M9 19.5v-6h6v6"/></>,
  timeline: <><path d="M12 21v-7.5"/><path d="M12 13.5C12 9.6 9.1 6.8 4.8 6.8c0 3.9 2.9 6.7 7.2 6.7"/><path d="M12 10.8c0-3.9 2.9-6.8 7.2-6.8 0 3.9-2.9 6.8-7.2 6.8"/></>,
  capture: <><path d="M12 5.6v12.8M5.6 12h12.8"/><circle cx="12" cy="12" r="9.2"/></>,
  inbox: <><path d="M4 5h16v14H4z"/><path d="M4 14h4l2 2h4l2-2h4"/></>,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></>,
  search: <><circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.7 15.7 4.6 4.6"/></>,
  people: <><circle cx="9.2" cy="8" r="3.1"/><path d="M3.6 19.6c.7-3.5 2.8-5.4 5.6-5.4s4.9 1.9 5.6 5.4"/><path d="M15.6 5.2a3.1 3.1 0 0 1 0 5.7M17.3 14.5c1.7.8 2.8 2.4 3.1 5.1"/></>,
  person: <><circle cx="12" cy="7.6" r="3.4"/><path d="M5.6 20c.8-3.9 3.2-6 6.4-6s5.6 2.1 6.4 6"/></>,
  story: <><path d="M5 4.5h10a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M8 4.5v15M11 8h4M11 12h4"/></>,
  microphone: <><rect x="8.6" y="3.2" width="6.8" height="11.4" rx="3.4"/><path d="M5.8 11.4a6.2 6.2 0 0 0 12.4 0M12 17.6v3.2M9.2 20.8h5.6"/></>,
  capsule: <><path d="M7.1 5.1a5 5 0 0 1 7.1 0l4.7 4.7a5 5 0 0 1-7.1 7.1l-4.7-4.7a5 5 0 0 1 0-7.1Z"/><path d="m8.3 13.4 5.1-5.1"/></>,
  book: <><path d="M12 5.8C10.2 4.3 7.7 3.8 4.5 3.8v14.9c3.2 0 5.7.5 7.5 2 1.8-1.5 4.3-2 7.5-2V3.8c-3.2 0-5.7.5-7.5 2z"/><path d="M12 5.8v14.9"/></>,
  settings: <><path d="M4 7.2h8.2M16.8 7.2H20"/><circle cx="14.5" cy="7.2" r="2.1"/><path d="M4 12h3.2M11.8 12H20"/><circle cx="9.5" cy="12" r="2.1"/><path d="M4 16.8h9.2M17.8 16.8H20"/><circle cx="15.5" cy="16.8" r="2.1"/></>,
  trash: <><path d="M5 7h14M9.8 7V5h4.4v2M7.2 7l.9 13h7.8l.9-13M10.4 10.8v5M13.6 10.8v5"/></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><circle cx="9" cy="9.4" r="1.8"/><path d="m4.5 16.6 4.6-4.6 2.8 2.8 2.1-2.1 5.5 5.5"/></>,
  audio: <><path d="M9.5 17.8V6.5l8.5-2.3v11.2"/><circle cx="7" cy="17.8" r="2.5"/><circle cx="15.5" cy="15.4" r="2.5"/></>,
  video: <><rect x="3.5" y="6.5" width="12.8" height="11.5" rx="2.6"/><path d="m16.3 10.6 4.2-2.3v7.4l-4.2-2.3"/></>,
  upload: <><path d="M12 16V3M7 8l5-5 5 5M4 14v6h16v-6"/></>,
  edit: <><path d="M4.8 19.2l.9-3.8L15.9 5.2l2.9 2.9L8.6 18.3z"/><path d="m14.4 6.7 2.9 2.9"/></>,
  archive: <><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/></>,
  "chevron-right": <path d="m9.5 6 6 6-6 6"/>,
  "arrow-left": <><path d="m10.5 5.5-6.5 6.5 6.5 6.5M4 12h16"/></>,
  camera: <><path d="M9 6.8 10.3 4.8h3.4L15 6.8h4.4a1.6 1.6 0 0 1 1.6 1.6v10.4a1.6 1.6 0 0 1-1.6 1.6H4.6a1.6 1.6 0 0 1-1.6-1.6V8.4a1.6 1.6 0 0 1 1.6-1.6z"/><circle cx="12" cy="13.2" r="3.6"/></>,
  lock: <><rect x="5.8" y="10.5" width="12.4" height="9.7" rx="2.6"/><path d="M8.8 10.5V7.7a3.2 3.2 0 0 1 6.4 0v2.8"/></>,
  check: <path d="m5 12.6 4.4 4.4L19 7.4"/>,
  spark: <><path d="M12 2.5c.5 5 2.5 7 7.5 7.5-5 .5-7 2.5-7.5 7.5-.5-5-2.5-7-7.5-7.5 5-.5 7-2.5 7.5-7.5Z"/><path d="M19 15.5c.2 2 1 2.8 3 3-2 .2-2.8 1-3 3-.2-2-1-2.8-3-3 2-.2 2.8-1 3-3Z"/></>,
  calendar: <><rect x="4" y="5.5" width="16" height="15" rx="3"/><path d="M4 10.5h16M9 3.5v4M15 3.5v4"/></>,
  heart: <path d="M12 19.8s-7.3-4.6-7.3-9.6A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.3 3c0 5-7.3 9.6-7.3 9.6z"/>,
};

export function Icon({ name, size = 22, className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
