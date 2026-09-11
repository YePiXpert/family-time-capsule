/** Shared by the native app, Web shell and book renderers. No runtime dependencies. */
export const journalColors = {
  paper: "#FAF9F5",
  card: "#FFFEFA",
  elevated: "#FFFFFF",
  ink: "#28251F",
  muted: "#6F6A60",
  faint: "#8B8275",
  line: "#E6DFD4",
  // Deeper than the reference's #CC785C so small white button labels stay readable.
  coral: "#A65D43",
  coralDark: "#8C4933",
  onCoral: "#FFFFFF",
  softCoral: "#F3E5DB",
  peach: "#DDAD97",
  apricot: "#F0EADF",
  sage: "#526D5D",
  softSage: "#ECF1E9",
  warning: "#88601E",
  warningSoft: "#FFF1D9",
  error: "#A03C36",
  errorSoft: "#F9E7E4",
  dangerLine: "#D9AAA1",
  scrim: "rgba(59,48,43,0.32)",
  mediaBackdrop: "#1B1715",
} as const;

/** Evening-lamp dark palette: warm, low contrast, same roles as the light set. */
export const journalDarkColors: JournalPalette = {
  paper: "#201E1A",
  card: "#292621",
  elevated: "#332E28",
  ink: "#F2EEE5",
  muted: "#BFB6AA",
  faint: "#8A7A6F",
  line: "#474037",
  coral: "#E4A084",
  coralDark: "#EAB49B",
  onCoral: "#2A1512",
  softCoral: "#472B25",
  peach: "#C98A76",
  apricot: "#3D3129",
  sage: "#9DB5A4",
  softSage: "#2C332D",
  warning: "#D9A45B",
  warningSoft: "#41321D",
  error: "#E0877E",
  errorSoft: "#472724",
  dangerLine: "#6E453F",
  scrim: "rgba(12,9,7,0.55)",
  mediaBackdrop: "#12100E",
} as const;

export type JournalPalette = Record<keyof typeof journalColors, string>;
export type JournalColorScheme = "light" | "dark";

/** Native system fonts: Chinese editorial headings, no network font dependency. */
export const journalFont = { editorialIOS: "Songti SC", editorialAndroid: "serif" } as const;
export const journalType = { hero: 32, title: 30, heading: 20, body: 16, label: 14, caption: 13, largeTitle: 32 } as const;
export const journalSpace = { hair: 4, small: 8, medium: 16, page: 20, large: 28 } as const;
export const journalRadius = { chip: 10, control: 12, card: 18, sheet: 28, pill: 999 } as const;
/** Base 180ms; sheets/menus use a slightly longer travel. */
export const journalMotion = { duration: 180, sheetDuration: 280, spring: { damping: 22, stiffness: 260, mass: 1 } } as const;

/** Hairline shadow values kept as strings for RN boxShadow and web parity. */
export const journalShadow = {
  card: "0 1px 2px rgba(59,48,43,0.04), 0 8px 24px rgba(59,48,43,0.06)",
  float: "0 4px 18px rgba(40,37,31,0.10)",
  floatDark: "0 6px 24px rgba(0,0,0,0.45)",
} as const;

/**
 * Liquid glass material tiers. dock: navigation & floating capture; card: memory
 * cards, list groups, inputs; sheet: bottom sheets & dialogs; overlay: photo tools
 * and floating menus. Reading surfaces (book paper, article body) stay solid.
 */
export type JournalGlassTier = "dock" | "card" | "sheet" | "overlay";

export const journalGlass = {
  /** Web backdrop-filter per tier; card keeps blur low for long-list performance. */
  filter: {
    dock: "blur(20px) saturate(165%)",
    card: "blur(14px) saturate(150%)",
    sheet: "blur(24px) saturate(160%)",
    overlay: "blur(28px) saturate(150%)",
  },
  /** Diagonal sheen stops (bright top-left → translucent → warm tint), 135deg. */
  tint: {
    light: {
      dock: ["rgba(255,255,255,0.64)", "rgba(255,253,249,0.30)", "rgba(239,185,168,0.22)"],
      card: ["rgba(255,255,255,0.55)", "rgba(255,253,249,0.28)", "rgba(239,185,168,0.14)"],
      sheet: ["rgba(255,255,255,0.72)", "rgba(255,253,249,0.42)", "rgba(239,185,168,0.26)"],
      overlay: ["rgba(255,255,255,0.60)", "rgba(255,253,249,0.30)", "rgba(239,185,168,0.18)"],
    },
    dark: {
      dock: ["rgba(53,43,37,0.72)", "rgba(43,35,31,0.38)", "rgba(224,135,118,0.10)"],
      card: ["rgba(53,43,37,0.66)", "rgba(43,35,31,0.36)", "rgba(224,135,118,0.08)"],
      sheet: ["rgba(61,49,41,0.80)", "rgba(43,35,31,0.52)", "rgba(224,135,118,0.12)"],
      overlay: ["rgba(53,43,37,0.70)", "rgba(43,35,31,0.40)", "rgba(224,135,118,0.10)"],
    },
  },
  /** Hairline rim: top/left catch the light, right/bottom take warm shade. */
  rim: {
    light: { top: "rgba(255,255,255,0.95)", left: "rgba(255,255,255,0.80)", right: "rgba(173,81,69,0.12)", bottom: "rgba(173,81,69,0.18)" },
    dark: { top: "rgba(255,255,255,0.20)", left: "rgba(255,255,255,0.12)", right: "rgba(224,135,118,0.10)", bottom: "rgba(0,0,0,0.35)" },
  },
  scrim: { light: "rgba(59,48,43,0.28)", dark: "rgba(12,9,7,0.55)" },
} as const;
