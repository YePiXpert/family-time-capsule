/** Shared by the native app, Web shell and book renderers. No runtime dependencies. */
export const journalColors = {
  paper: "#F7F8F5",
  card: "#FFFFFF",
  elevated: "#FFFFFF",
  ink: "#202923",
  muted: "#616B64",
  faint: "#727C75",
  line: "#E1E6DF",
  // Historical color keys remain compatible; coral now means the moss brand accent.
  coral: "#426A58",
  coralDark: "#345744",
  onCoral: "#FFFFFF",
  softCoral: "#E8F0E9",
  peach: "#B8CFBD",
  apricot: "#EDF0EA",
  sage: "#426A58",
  softSage: "#E8F0E9",
  warning: "#88601E",
  warningSoft: "#FFF1D9",
  error: "#A03C36",
  errorSoft: "#F9E7E4",
  dangerLine: "#D9AAA1",
  scrim: "rgba(59,48,43,0.32)",
  mediaBackdrop: "#172019",
} as const;

/** Independent dark surfaces keep text and controls legible. */
export const journalDarkColors: JournalPalette = {
  paper: "#171C19",
  card: "#202722",
  elevated: "#2B342D",
  ink: "#F0F4EF",
  muted: "#B7C2B8",
  faint: "#98A59A",
  line: "#3A463D",
  coral: "#A6CCB5",
  coralDark: "#BEDCC9",
  onCoral: "#173224",
  softCoral: "#2B4033",
  peach: "#577762",
  apricot: "#2A352D",
  sage: "#A6CCB5",
  softSage: "#2B4033",
  warning: "#D9A45B",
  warningSoft: "#41321D",
  error: "#E0877E",
  errorSoft: "#472724",
  dangerLine: "#6E453F",
  scrim: "rgba(12,9,7,0.55)",
  mediaBackdrop: "#111713",
} as const;

export type JournalPalette = Record<keyof typeof journalColors, string>;
export type JournalColorScheme = "light" | "dark";

/** System sans-serif on both platforms; legacy key names remain compatible. */
export const journalFont = { editorialIOS: "System", editorialAndroid: "sans-serif" } as const;
export const journalType = { hero: 24, title: 24, pageTitle: 24, recordTitle: 18, heading: 20, body: 16, label: 14, caption: 13, largeTitle: 24 } as const;
export const journalSpace = { hair: 4, small: 8, medium: 16, page: 20, large: 28 } as const;
export const journalRadius = { chip: 10, control: 12, card: 16, sheet: 24, pill: 999 } as const;
/** Base 180ms; sheets/menus use a slightly longer travel. */
export const journalMotion = { duration: 180, sheetDuration: 280, spring: { damping: 22, stiffness: 260, mass: 1 } } as const;

/** Hairline shadow values kept as strings for RN boxShadow and web parity. */
export const journalShadow = {
  card: "0 1px 3px rgba(25,40,30,0.04)",
  float: "0 2px 8px rgba(25,40,30,0.08)",
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
      dock: ["rgba(255,255,255,0.64)", "rgba(255,253,249,0.30)", "rgba(166,204,181,0.22)"],
      card: ["rgba(255,255,255,0.55)", "rgba(255,253,249,0.28)", "rgba(166,204,181,0.14)"],
      sheet: ["rgba(255,255,255,0.72)", "rgba(255,253,249,0.42)", "rgba(166,204,181,0.26)"],
      overlay: ["rgba(255,255,255,0.60)", "rgba(255,253,249,0.30)", "rgba(166,204,181,0.18)"],
    },
    dark: {
      dock: ["rgba(32,39,34,0.72)", "rgba(32,39,34,0.38)", "rgba(166,204,181,0.10)"],
      card: ["rgba(32,39,34,0.66)", "rgba(32,39,34,0.36)", "rgba(166,204,181,0.08)"],
      sheet: ["rgba(43,52,45,0.80)", "rgba(32,39,34,0.52)", "rgba(166,204,181,0.12)"],
      overlay: ["rgba(32,39,34,0.70)", "rgba(32,39,34,0.40)", "rgba(166,204,181,0.10)"],
    },
  },
  /** Hairline rim: top/left catch the light, right/bottom take warm shade. */
  rim: {
    light: { top: "rgba(255,255,255,0.95)", left: "rgba(255,255,255,0.80)", right: "rgba(66,106,88,0.12)", bottom: "rgba(66,106,88,0.18)" },
    dark: { top: "rgba(255,255,255,0.20)", left: "rgba(255,255,255,0.12)", right: "rgba(166,204,181,0.10)", bottom: "rgba(0,0,0,0.35)" },
  },
  scrim: { light: "rgba(59,48,43,0.28)", dark: "rgba(12,9,7,0.55)" },
} as const;
