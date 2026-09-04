import type { SVGProps } from "react";

export type IconName =
  | "home"
  | "timeline"
  | "capture"
  | "inbox"
  | "more"
  | "search"
  | "people"
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
  | "spark";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: IconName;
  size?: number;
};

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="M3.5 10.5 12 3l8.5 7.5"/><path d="M5.5 9.5v10h13v-10M9 19.5v-6h6v6"/></>,
  timeline: <><path d="M6 4v16M6 7h5M6 12h9M6 17h12"/><circle cx="6" cy="7" r="1.5"/><circle cx="6" cy="12" r="1.5"/><circle cx="6" cy="17" r="1.5"/></>,
  capture: <><path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/></>,
  inbox: <><path d="M4 5h16v14H4z"/><path d="M4 14h4l2 2h4l2-2h4"/></>,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></>,
  people: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-4 2.4-6 5.5-6s5 2 5.5 6"/><path d="M15 6.5a2.5 2.5 0 0 1 0 5M16 13.5c2.5.5 4 2.3 4.5 5.5"/></>,
  story: <><path d="M5 4.5h10a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M8 4.5v15M11 8h4M11 12h4"/></>,
  microphone: <><rect x="8.5" y="3" width="7" height="12" rx="3.5"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/></>,
  capsule: <><path d="M7.1 5.1a5 5 0 0 1 7.1 0l4.7 4.7a5 5 0 0 1-7.1 7.1l-4.7-4.7a5 5 0 0 1 0-7.1Z"/><path d="m8.3 13.4 5.1-5.1"/></>,
  book: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></>,
  trash: <><path d="M5 7h14M9 3h6l1 4H8zM7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-5 3 3 2-2 6 6"/></>,
  audio: <><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></>,
  video: <><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2z"/></>,
  upload: <><path d="M12 16V3M7 8l5-5 5 5M4 14v6h16v-6"/></>,
  edit: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.5 7l3.5 3.5"/></>,
  archive: <><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/></>,
  "chevron-right": <path d="m9 5 7 7-7 7"/>,
  "arrow-left": <><path d="m10 5-7 7 7 7M3 12h18"/></>,
  spark: <><path d="M12 2.5c.5 5 2.5 7 7.5 7.5-5 .5-7 2.5-7.5 7.5-.5-5-2.5-7-7.5-7.5 5-.5 7-2.5 7.5-7.5Z"/><path d="M19 15.5c.2 2 1 2.8 3 3-2 .2-2.8 1-3 3-.2-2-1-2.8-3-3 2-.2 2.8-1 3-3Z"/></>,
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
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
