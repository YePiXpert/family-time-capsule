/** Shared by the native app, Web shell and book renderers. No runtime dependencies. */
export const journalColors = {
  paper: "#FFFAF5",
  card: "#FFFDF9",
  ink: "#3B302B",
  muted: "#77675E",
  line: "#EADFD5",
  coral: "#AD5145",
  coralDark: "#914237",
  softCoral: "#FBE9E3",
  peach: "#EFB9A8",
  apricot: "#F5E6D2",
  sage: "#526D5D",
  softSage: "#ECF1E9",
  warning: "#88601E",
  error: "#A03C36",
} as const;

export const journalType = { title: 30, heading: 20, body: 16, label: 14, caption: 13 } as const;
export const journalSpace = { small: 8, medium: 16, page: 20, large: 28 } as const;
export const journalRadius = { control: 14, card: 22, pill: 999 } as const;
export const journalMotion = { duration: 180 } as const;
