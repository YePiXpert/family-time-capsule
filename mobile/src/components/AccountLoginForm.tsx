import { Text, TextInput } from "./typography";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { signIn, signOut, TwoFactorRequiredError, verifyTwoFactor, type TwoFactorChallenge } from "../api/client";
import type { Credentials } from "../types";
import { useSharedStyles } from "../theme";

export function AccountLoginForm({ serverUrl: fixedServerUrl, onLogin, buttonLabel = "登录" }: {
  serverUrl?: string;
  onLogin: (credentials: Credentials) => Promise<void>;
  buttonLabel?: string;
}) {
  const s = useSharedStyles();
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<TwoFactorChallenge | null>(null);
  const [method, setMethod] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  const cancel = () => {
    generation.current++; inFlight.current = false;
    setPending(null); setCode(""); setPassword(""); setError(null); setBusy(false);
  };
  const submit = async () => {
    if (inFlight.current) return;
    const target = fixedServerUrl ?? serverUrl;
    if (pending ? !code.trim() : !target.trim() || !email.trim() || !password) {
      setError(pending ? "请输入动态码或恢复码。" : "请填写服务器地址、邮箱和密码。"); return;
    }
    inFlight.current = true; setBusy(true); setError(null);
    const round = ++generation.current;
    let authenticated = false;
    try {
      const credentials = pending ? await verifyTwoFactor(pending, code, method) : await signIn(target, email, password);
      if (generation.current !== round) { await signOut(credentials); return; }
      authenticated = true;
      setPending(null); setCode(""); setPassword("");
      await onLogin(credentials);
    } catch (reason) {
      if (generation.current !== round) return;
      if (reason instanceof TwoFactorRequiredError) {
        setPending(reason.pending); setPassword(""); setCode(""); setMethod("totp");
      } else {
        setError(authenticated ? "登录已验证，但连接未完成，请重新登录。" : reason instanceof Error ? reason.message : "登录失败，请重试。");
      }
    } finally {
      if (generation.current === round) { inFlight.current = false; setBusy(false); }
    }
  };
  return <View style={{ gap: 10 }}>
    {pending ? <>
      <Text style={s.cardTitle}>两步验证</Text>
      <Text style={s.body}>正在登录 {pending.serverUrl}。请输入验证器中的动态码；无法使用验证器时，可用一枚未使用的恢复码。</Text>
      <TextInput accessibilityLabel={method === "totp" ? "动态验证码" : "一次性恢复码"} editable={!busy} autoCapitalize="none" autoCorrect={false} autoComplete={method === "totp" ? "one-time-code" : "off"} keyboardType={method === "totp" ? "number-pad" : "default"} secureTextEntry={method === "backup"} maxLength={method === "totp" ? 6 : 128} value={code} onChangeText={setCode} style={s.input} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setMethod(method === "totp" ? "backup" : "totp"); setCode(""); setError(null); }} style={s.secondaryButton}><Text style={s.secondaryText}>{method === "totp" ? "改用恢复码" : "改用动态码"}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={cancel} style={s.secondaryButton}><Text style={s.secondaryText}>取消验证，重新登录</Text></Pressable>
    </> : <>
      {!fixedServerUrl ? <><Text style={s.label}>家庭空间地址</Text><TextInput accessibilityLabel="家庭空间地址" editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="url" value={serverUrl} onChangeText={setServerUrl} placeholder="https://capsule.example.com" style={s.input} /></> : null}
      <Text style={s.label}>邮箱</Text><TextInput accessibilityLabel="邮箱" editable={!busy} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} style={s.input} />
      <Text style={s.label}>密码</Text><TextInput accessibilityLabel="密码" editable={!busy} autoCapitalize="none" autoComplete="current-password" secureTextEntry value={password} onChangeText={setPassword} style={s.input} />
    </>}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={s.primaryButton}>{busy ? <ActivityIndicator color={s.colors.onCoral} /> : <Text style={s.primaryText}>{pending ? "验证并登录" : buttonLabel}</Text>}</Pressable>
    <Text style={s.body}>验证完成后才保存登录凭据。验证期间不会上传本机记录。</Text>
  </View>;
}
