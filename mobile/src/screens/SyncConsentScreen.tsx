import { Text } from "../components/typography";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../state/AppContext";
import { useAlertSheet } from "../components/GlassSheet";
import { useSharedStyles } from "../theme";
import type { JournalPalette } from "../design/tokens";
import type { MediaCapturePayload, TextCapturePayload } from "../types";

/**
 * 首次同步授权门（M4）：明确显示目标家庭空间、账号与本机待传数量，
 * 用户选择“同步全部 / 部分同步 / 仅保留本机”之后才允许上传。
 * 网络恢复、切前后台都不会绕过此门；选择结果绑定该目的地。
 */
export function SyncConsentScreen() {
  const s = useSharedStyles();
  const styles = useMemo(() => createStyles(s.colors), [s.colors]);
  const { credentials, outbox, family, grantSyncConsent } = useApp();
  const insets = useSafeAreaInsets();
  const alert = useAlertSheet();
  const [mode, setMode] = useState<"choose" | "select">("choose");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  const destinations = useMemo(
    () => credentials?.serverUrl.replace(/^https?:\/\//u, "") ?? "",
    [credentials],
  );

  const submit = (scope: "all" | "local") => {
    setWorking(true);
    void grantSyncConsent(scope).finally(() => setWorking(false));
  };

  const submitSelected = () => {
    if (selected.size === 0) {
      void alert({ title: "尚未选择", message: "勾选要同步的记录，或改选“仅保留本机”。" });
      return;
    }
    setWorking(true);
    void grantSyncConsent("selected", [...selected]).finally(() => setWorking(false));
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top + 18 }]}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.eyebrow}>同步授权</Text>
        <Text style={s.title}>要把本机记录同步给这个家庭吗？</Text>
        <View style={s.card}>
          <Text style={s.cardTitle}>目标家庭空间</Text>
          <Text style={s.body}>{destinations}</Text>
          {family ? <Text style={s.body}>家庭：{family.name}</Text> : null}
          <Text style={s.body}>
            本机有 {outbox.length} 条记录尚未同步。在你明确同意之前，任何网络恢复或前后台切换都不会上传它们。
          </Text>
        </View>

        {mode === "choose" ? (
          <View style={{ gap: 10 }}>
            <Pressable disabled={working} onPress={() => submit("all")} style={s.primaryButton}>
              {working ? <ActivityIndicator color={s.colors.onCoral} /> : <Text style={s.primaryText}>同步全部本机记录</Text>}
            </Pressable>
            <Pressable disabled={working} onPress={() => setMode("select")} style={s.secondaryButton}>
              <Text style={s.secondaryText}>选择要同步的记录</Text>
            </Pressable>
            <Pressable disabled={working} onPress={() => submit("local")} style={styles.localButton}>
              <Text style={styles.localText}>仅保留在本机（不上传）</Text>
            </Pressable>
            <Text style={styles.note}>“仅保留在本机”不会删除任何原件；之后仍可在设置中对这个家庭重新授权。</Text>
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.cardTitle}>选择要同步的记录（{selected.size}/{outbox.length}）</Text>
            {outbox.map((item) => {
              const checked = selected.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                  style={[styles.itemRow, checked && styles.itemRowActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={styles.itemTitle}>
                      {item.kind === "media_capture"
                        ? `〔媒体〕${(item.payload as MediaCapturePayload).fileName}`
                        : `〔文字〕${(item.payload as TextCapturePayload).text}`}
                    </Text>
                  </View>
                  <Text style={styles.itemMark}>{checked ? "✓" : ""}</Text>
                </Pressable>
              );
            })}
            <Pressable disabled={working} onPress={submitSelected} style={s.primaryButton}>
              {working ? <ActivityIndicator color={s.colors.onCoral} /> : <Text style={s.primaryText}>同步所选 {selected.size} 条</Text>}
            </Pressable>
            <Pressable disabled={working} onPress={() => setMode("choose")} style={styles.backLink}>
              <Text style={styles.backText}>返回上一页</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(palette: JournalPalette) {
  return StyleSheet.create({
  localButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderColor: palette.line,
    borderRadius: 13,
    borderWidth: 1.5,
    paddingHorizontal: 16,
  },
  localText: { color: palette.muted, fontSize: 15, fontWeight: "800" },
  note: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderColor: palette.line,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  itemRowActive: { borderColor: palette.coral, backgroundColor: palette.softCoral },
  itemTitle: { color: palette.ink, fontSize: 14, fontWeight: "700" },
  itemMark: { color: palette.coralDark, fontSize: 18, fontWeight: "900" },
  backLink: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  backText: { color: palette.coralDark, fontSize: 14, fontWeight: "800" },
  });
}
