import { Text } from "./typography";
import { View } from "react-native";
import { AccountLoginForm } from "./AccountLoginForm";
import { useSharedStyles } from "../theme";
import type { Credentials } from "../types";

export function ServerConnectionForm({ onLogin }: { onLogin: (credentials: Credentials) => Promise<void> }) {
  const s = useSharedStyles();
  return <View style={{ ...s.card, gap: 10 }}>
    <Text style={s.cardTitle}>连接家庭服务器（可选）</Text>
    <Text style={s.body}>不连接也能在本机记录；连接后才会补传并下载家庭档案。</Text>
    <AccountLoginForm onLogin={onLogin} buttonLabel="连接并同步" />
    <Text style={s.body}>会话令牌只保存在系统 Keychain / Keystore。</Text>
  </View>;
}
