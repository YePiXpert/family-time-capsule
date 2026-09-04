import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { signIn } from "../api/client";
import { colors, sharedStyles } from "../theme";
import type { Credentials } from "../types";

export function ServerConnectionForm({
  onLogin,
}: {
  onLogin: (credentials: Credentials) => Promise<void>;
}) {
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!serverUrl.trim() || !email.trim() || !password) {
      setError("请填写服务器地址、邮箱和密码。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onLogin(await signIn(serverUrl, email, password));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败。");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <View style={styles.wrap}>
      <Text style={sharedStyles.cardTitle}>连接家庭服务器（可选）</Text>
      <Text style={sharedStyles.body}>不连接也能在本机记录；连接后才会补传并下载家庭档案。</Text>
      <Text style={sharedStyles.label}>家庭服务器</Text>
      <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={setServerUrl} placeholder="https://capsule.example.com" style={sharedStyles.input} value={serverUrl} />
      <Text style={sharedStyles.label}>邮箱</Text>
      <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} style={sharedStyles.input} value={email} />
      <Text style={sharedStyles.label}>密码</Text>
      <TextInput autoCapitalize="none" autoComplete="current-password" onChangeText={setPassword} secureTextEntry style={sharedStyles.input} value={password} />
      {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
      <Pressable disabled={submitting} onPress={() => void submit()} style={sharedStyles.primaryButton}>
        {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={sharedStyles.primaryText}>连接并同步</Text>}
      </Pressable>
      <Text style={styles.note}>会话令牌只保存在系统 Keychain / Keystore。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...sharedStyles.card, gap: 10 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
});
