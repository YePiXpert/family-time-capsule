/** Shared by the native app, Web shell and book renderers. No runtime dependencies. */
export const journalColors = {
  paper: "#FFFAF5",
  card: "#FFFDF9",
  elevated: "#FFFFFF",
  ink: "#3B302B",
  muted: "#77675E",
  faint: "#A8978C",
  line: "#EADFD5",
  coral: "#AD5145",
  coralDark: "#914237",
  onCoral: "#FFF9F6",
  softCoral: "#FBE9E3",
  peach: "#EFB9A8",
  apricot: "#F5E6D2",
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
  paper: "#221B17",
  card: "#2B231F",
  elevated: "#352B25",
  ink: "#F2E7DE",
  muted: "#B9A89C",
  faint: "#8A7A6F",
  line: "#453931",
  coral: "#E08776",
  coralDark: "#EFAA98",
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

export const journalType = { hero: 34, title: 30, heading: 20, body: 16, label: 14, caption: 13 } as const;
export const journalSpace = { hair: 4, small: 8, medium: 16, page: 20, large: 28 } as const;
export const journalRadius = { chip: 12, control: 14, card: 22, sheet: 28, pill: 999 } as const;
export const journalMotion = { duration: 180 } as const;

/** Hairline shadow values kept as strings for RN boxShadow and web parity. */
export const journalShadow = {
  card: "0 1px 2px rgba(59,48,43,0.04), 0 8px 24px rgba(59,48,43,0.06)",
  float: "0 6px 24px rgba(59,48,43,0.14)",
  floatDark: "0 6px 24px rgba(0,0,0,0.45)",
} as const;
