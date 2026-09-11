import { Component, useState, type PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, sharedStyles } from "../theme";

export function RecoveryView({ title, detail, retry }: { title: string; detail: string; retry: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <View style={styles.container}>
    <Text accessibilityRole="header" style={sharedStyles.emptyTitle}>{title}</Text>
    <Text style={sharedStyles.body}>{detail}</Text>
    <Text style={sharedStyles.body}>已保存的资料仍在本机，请保留应用，稍后重试。</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="重试" disabled={busy}
      onPress={() => {
        setBusy(true);
        // The owner displays persistent failure state; never let a retry escape the UI boundary.
        void Promise.resolve().then(retry).catch(() => {}).finally(() => setBusy(false));
      }} style={sharedStyles.secondaryButton}>
      <Text style={sharedStyles.secondaryText}>{busy ? "正在重试…" : "重试"}</Text>
    </Pressable>
  </View>;
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
  container: { flex: 1, justifyContent: "center", gap: 14, padding: 28, backgroundColor: colors.paper },
});
