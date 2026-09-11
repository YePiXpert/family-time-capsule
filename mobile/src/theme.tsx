import { createContext, useContext, useMemo, type ReactNode } from "react";
import { StyleSheet, useColorScheme } from "react-native";

import {
  journalColors,
  journalDarkColors,
  journalRadius,
  journalSpace,
  journalType,
  type JournalColorScheme,
  type JournalPalette,
} from "./design/tokens";

export const colors = journalColors;

export type ThemeMode = "auto" | "light" | "dark";

const SchemeContext = createContext<JournalColorScheme>("light");

export function JournalThemeProvider({ mode, children }: { mode: ThemeMode; children: ReactNode }) {
  const system = useColorScheme();
  const scheme: JournalColorScheme = mode === "auto" ? (system === "dark" ? "dark" : "light") : mode;
  return <SchemeContext.Provider value={scheme}>{children}</SchemeContext.Provider>;
}

export function useColorTheme(): { scheme: JournalColorScheme; dark: boolean; colors: JournalPalette } {
  const scheme = useContext(SchemeContext);
  const palette = scheme === "dark" ? journalDarkColors : journalColors;
  return { scheme, dark: scheme === "dark", colors: palette };
}

export function createSharedStyles(palette: JournalPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.paper },
    content: { padding: journalSpace.page, paddingBottom: 170, gap: journalSpace.medium },
    eyebrow: {
      color: palette.coral,
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 1.2,
    },
    title: { color: palette.ink, fontSize: journalType.title, fontWeight: "600" },
    intro: { color: palette.muted, fontSize: journalType.body },
    card: {
      backgroundColor: palette.card,
      borderColor: palette.line,
      borderRadius: journalRadius.card,
      borderWidth: 1,
      padding: 16,
      gap: 9,
    },
    cardTitle: { color: palette.ink, fontSize: journalType.heading, fontWeight: "600" },
    body: { color: palette.muted, fontSize: journalType.body },
    label: { color: palette.ink, fontSize: journalType.label, fontWeight: "600" },
    input: {
      minHeight: 48,
      backgroundColor: palette.card,
      borderColor: palette.line,
      borderRadius: journalRadius.control,
      borderWidth: 1,
      color: palette.ink,
      fontSize: 16,
      paddingHorizontal: 13,
      paddingVertical: 11,
    },
    primaryButton: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.coral,
      borderRadius: journalRadius.control,
      paddingHorizontal: 16,
    },
    primaryText: { color: palette.onCoral, fontSize: 15, fontWeight: "600" },
    secondaryButton: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderColor: palette.line,
      backgroundColor: palette.card,
      borderRadius: journalRadius.control,
      borderWidth: 1,
      paddingHorizontal: 16,
    },
    secondaryText: { color: palette.coralDark, fontSize: 15, fontWeight: "600" },
    notice: { backgroundColor: palette.softSage, borderRadius: 12, padding: 12 },
    noticeText: { color: palette.sage, fontSize: 13 },
    warning: { backgroundColor: palette.warningSoft, borderRadius: 12, padding: 12 },
    warningText: { color: palette.warning, fontSize: 13 },
    error: { color: palette.error, fontSize: 13 },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 9 },
    emptyTitle: { color: palette.ink, fontSize: 20, fontWeight: "700", textAlign: "center" },
    emptyText: { color: palette.muted, fontSize: 14, textAlign: "center" },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.5 },
  });
}

export type SharedStyles = ReturnType<typeof createSharedStyles>;

/** Light default for legacy static imports; themed screens should use useSharedStyles(). */
export const sharedStyles = createSharedStyles(journalColors);

export function useSharedStyles(): SharedStyles & { colors: JournalPalette; dark: boolean } {
  const { colors: palette, dark } = useColorTheme();
  return useMemo(() => Object.assign(createSharedStyles(palette), { colors: palette, dark }), [palette, dark]);
}
