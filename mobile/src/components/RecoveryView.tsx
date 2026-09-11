import { Component, useState, type PropsWithChildren } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { Text } from "./typography";
import { colors, sharedStyles } from "../theme";

export function RecoveryView({ title, detail, retry }: { title: string; detail: string; retry: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
    <Text accessibilityRole="header" style={sharedStyles.emptyTitle}>{title}</Text>
    <Text style={sharedStyles.emptyText}>已保存的资料仍在本机，请保留应用，稍后重试。</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="重试" disabled={busy}
      onPress={() => {
        setBusy(true);
        // The owner displays persistent failure state; never let a retry escape the UI boundary.
        void Promise.resolve().then(retry).catch(() => {}).finally(() => setBusy(false));
      }} style={sharedStyles.primaryButton}>
      <Text style={sharedStyles.primaryText}>{busy ? "正在重试…" : "重试"}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsVisible }}
      onPress={() => setDetailsVisible(value => !value)} style={styles.detailsButton}>
      <Text style={sharedStyles.secondaryText}>{detailsVisible ? "收起错误详情" : "查看错误详情"}</Text>
    </Pressable>
    {detailsVisible ? <Text selectable style={sharedStyles.body}>{detail}</Text> : null}
  </ScrollView>;
}

/** A screen render failure must not turn into an unrecoverable native launch loop. */
export class ScreenRecoveryBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <RecoveryView title="页面暂时无法打开" detail="请重新打开页面。" retry={() => this.setState({ failed: false })} />
      : this.props.children;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { flexGrow: 1, justifyContent: "center", gap: 16, padding: 28 },
  detailsButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
});
