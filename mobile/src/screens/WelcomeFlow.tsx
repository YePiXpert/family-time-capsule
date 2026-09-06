import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ApiError,
  bootstrapSetup,
  fetchBootstrap,
  signIn,
} from "../api/client";
import { useApp } from "../state/AppContext";
import { colors, sharedStyles } from "../theme";
import type { BootstrapInfo, Credentials } from "../types";

/**
 * 首次启动引导（1.3）：创建我的家庭 / 加入家人的家庭 / 暂时只在本机记录，
 * 次级入口“已有账号登录”。仅在无凭据且未处理过欢迎页时出现；
 * 已登录用户升级后直接进入主界面，不会重新看到本页。
 */

type Step = "welcome" | "create" | "join" | "login";

export function WelcomeFlow() {
  const [step, setStep] = useState<Step>("welcome");
  const insets = useSafeAreaInsets();
  return (
    <View style={[sharedStyles.screen, { paddingTop: insets.top + 18 }]}>
      <ScrollView contentContainerStyle={[sharedStyles.content, { flexGrow: 1 }]}>
        {step === "welcome" ? <WelcomeStep onChoose={setStep} /> : null}
        {step === "create" ? <CreateFamilyStep onBack={() => setStep("welcome")} /> : null}
        {step === "join" ? <JoinFamilyStep onBack={() => setStep("welcome")} onLogin={() => setStep("login")} /> : null}
        {step === "login" ? <LoginStep onBack={() => setStep("welcome")} /> : null}
      </ScrollView>
    </View>
  );
}

function StepHeader({ eyebrow, title, intro }: { eyebrow: string; title: string; intro: string }) {
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Text style={sharedStyles.eyebrow}>{eyebrow}</Text>
      <Text style={sharedStyles.title}>{title}</Text>
      <Text style={sharedStyles.intro}>{intro}</Text>
    </View>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Pressable onPress={onBack} style={styles.back}>
      <Text style={styles.backText}>← 返回</Text>
    </Pressable>
  );
}

function WelcomeStep({ onChoose }: { onChoose: (step: Step) => void }) {
  const { setWelcomeSeen } = useApp();
  return (
    <View style={{ gap: 16, justifyContent: "center", flexGrow: 1 }}>
      <StepHeader
        eyebrow="家庭时间胶囊"
        title="把家人的回忆留在自己手里"
        intro="记录保存在你自己的设备上；连接自托管的家庭空间后，才能与家人共享。这里没有官方云服务。"
      />
      <Pressable onPress={() => onChoose("create")} style={sharedStyles.primaryButton}>
        <Text style={sharedStyles.primaryText}>创建我的家庭</Text>
      </Pressable>
      <Pressable onPress={() => onChoose("join")} style={sharedStyles.secondaryButton}>
        <Text style={sharedStyles.secondaryText}>加入家人的家庭</Text>
      </Pressable>
      <Pressable onPress={() => void setWelcomeSeen()} style={sharedStyles.secondaryButton}>
        <Text style={sharedStyles.secondaryText}>暂时只在本机记录</Text>
      </Pressable>
      <Pressable onPress={() => onChoose("login")} style={styles.textButton}>
        <Text style={styles.plainLink}>已有账号登录</Text>
      </Pressable>
      <Text style={styles.note}>“创建我的家庭”需要家人空间管理员先在服务器上完成部署；之后可以随时在设置中连接。</Text>
    </View>
  );
}

function CreateFamilyStep({ onBack }: { onBack: () => void }) {
  const { connect } = useApp();
  const [serverUrl, setServerUrl] = useState("");
  const [info, setInfo] = useState<{ serverUrl: string; info: BootstrapInfo } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const detect = async () => {
    if (!serverUrl.trim()) {
      setError("请先填写家庭空间地址。");
      return;
    }
    setDetecting(true);
    setError(null);
    try {
      setInfo(await fetchBootstrap(serverUrl));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法识别该地址。");
      setInfo(null);
    } finally {
      setDetecting(false);
    }
  };

  const submitSetup = async () => {
    if (!info) return;
    if (!token.trim() || !displayName.trim() || !email.trim() || !password) {
      setError("请填写初始化令牌、称呼、邮箱和密码。");
      return;
    }
    if (password !== passwordConfirm) {
      setError("两次输入的密码不一致。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await bootstrapSetup(info.serverUrl, {
        token: token.trim(),
        displayName,
        email,
        password,
      });
      const credentials = await signIn(info.serverUrl, email, password);
      await connect(credentials);
    } catch (reason) {
      // 初始化成功但登录失败（如响应丢失）时，提示直接用刚设置的账号登录，
      // 不重建用户、不要求清空数据。
      if (reason instanceof ApiError && reason.status >= 401 && reason.status < 500) {
        setError(`${reason.message}\n如果刚才已提示初始化成功，请直接登录。`);
      } else {
        setError(reason instanceof Error ? reason.message : "初始化失败，请稍后重试。");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitLogin = async () => {
    if (!info) return;
    setLoginBusy(true);
    setError(null);
    try {
      const credentials = await signIn(info.serverUrl, loginEmail, loginPassword);
      await connect(credentials);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败。");
    } finally {
      setLoginBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <BackButton onBack={onBack} />
      <StepHeader
        eyebrow="创建我的家庭"
        title="连接家庭空间"
        intro="填写家人的自托管服务地址（管理员部署后获得），我们会先确认这是可用的家庭时间胶囊实例。"
      />
      <Text style={sharedStyles.label}>家庭空间地址</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setServerUrl}
        placeholder="https://capsule.example.com"
        style={sharedStyles.input}
        value={serverUrl}
      />
      <Pressable disabled={detecting} onPress={() => void detect()} style={sharedStyles.primaryButton}>
        {detecting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={sharedStyles.primaryText}>检测家庭空间</Text>}
      </Pressable>
      {error ? <Text style={sharedStyles.error}>{error}</Text> : null}

      {info ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>{info.serverUrl.replace(/^https?:\/\//u, "")}</Text>
          <Text style={sharedStyles.body}>
            {info.info.setup.state === "available"
              ? "这是一个新部署的家庭空间，可以创建第一个管理员账号。"
              : info.info.setup.state === "completed"
                ? "该家庭空间已有管理员。若你就是管理员或家人，请直接登录；或联系管理员邀请你加入。"
                : "该服务器尚未配置初始化令牌（INITIAL_SETUP_TOKEN），请联系部署者在服务器上完成配置。"}
          </Text>
        </View>
      ) : null}

      {info && info.info.setup.state === "available" ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>创建管理员账号</Text>
          <Text style={sharedStyles.label}>初始化令牌</Text>
          <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setToken} placeholder="部署时设置的 INITIAL_SETUP_TOKEN" style={sharedStyles.input} value={token} />
          <Text style={sharedStyles.label}>你的称呼</Text>
          <TextInput onChangeText={setDisplayName} placeholder="例如：妈妈" style={sharedStyles.input} value={displayName} />
          <Text style={sharedStyles.label}>邮箱（用于登录）</Text>
          <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} style={sharedStyles.input} value={email} />
          <Text style={sharedStyles.label}>密码（至少 10 位）</Text>
          <TextInput autoCapitalize="none" autoComplete="new-password" onChangeText={setPassword} secureTextEntry style={sharedStyles.input} value={password} />
          <Text style={sharedStyles.label}>确认密码</Text>
          <TextInput autoCapitalize="none" autoComplete="new-password" onChangeText={setPasswordConfirm} secureTextEntry style={sharedStyles.input} value={passwordConfirm} />
          <Pressable disabled={submitting} onPress={() => void submitSetup()} style={sharedStyles.primaryButton}>
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={sharedStyles.primaryText}>创建账号并登录</Text>}
          </Pressable>
        </View>
      ) : null}

      {info && info.info.setup.state === "completed" ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>登录该家庭空间</Text>
          <Text style={sharedStyles.label}>邮箱</Text>
          <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setLoginEmail} style={sharedStyles.input} value={loginEmail} />
          <Text style={sharedStyles.label}>密码</Text>
          <TextInput autoCapitalize="none" autoComplete="current-password" onChangeText={setLoginPassword} secureTextEntry style={sharedStyles.input} value={loginPassword} />
          <Pressable disabled={loginBusy} onPress={() => void submitLogin()} style={sharedStyles.primaryButton}>
            {loginBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={sharedStyles.primaryText}>登录</Text>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * M1 的加入家庭入口：解析完整邀请链接并确认目标服务器。
 * App 内直接接受邀请注册在后续版本提供；当前引导用浏览器打开
 * 邀请页完成注册，再回来登录（诚实标注，不假装已支持）。
 */
function JoinFamilyStep({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const origin = useMemo(() => {
    const trimmed = link.trim();
    if (!/^https?:\/\//iu.test(trimmed)) return null;
    try {
      const url = new URL(trimmed);
      if (url.username || url.password) return null;
      return url.origin;
    } catch {
      return null;
    }
  }, [link]);
  return (
    <View style={{ gap: 12 }}>
      <BackButton onBack={onBack} />
      <StepHeader
        eyebrow="加入家人的家庭"
        title="使用家人发来的邀请"
        intro="粘贴家人分享的完整邀请链接（https 开头），我们会显示将要连接的家庭空间。"
      />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        multiline
        onChangeText={(value) => {
          setLink(value);
          setError(null);
        }}
        placeholder="https://capsule.example.com/invite/…"
        style={[sharedStyles.input, styles.linkInput]}
        value={link}
      />
      {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
      {origin ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.cardTitle}>将连接的家庭空间</Text>
          <Text style={sharedStyles.body}>{origin}</Text>
          <Text style={sharedStyles.warning}>
            当前版本的 App 尚不能直接在应用内完成受邀注册。请在手机的浏览器中打开同一个邀请链接完成注册，然后回到这里登录。
          </Text>
          <Pressable onPress={onLogin} style={sharedStyles.primaryButton}>
            <Text style={sharedStyles.primaryText}>我已注册，去登录</Text>
          </Pressable>
        </View>
      ) : link.trim() ? (
        <Text style={sharedStyles.error}>邀请链接必须以 https:// 开头，且不能包含账号信息。</Text>
      ) : null}
    </View>
  );
}

function LoginStep({ onBack }: { onBack: () => void }) {
  const { connect } = useApp();
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!serverUrl.trim() || !email.trim() || !password) {
      setError("请填写服务器地址、邮箱和密码。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const credentials: Credentials = await signIn(serverUrl, email, password);
      await connect(credentials);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <BackButton onBack={onBack} />
      <StepHeader eyebrow="已有账号" title="登录家庭空间" intro="使用已有的邮箱和密码登录自托管家庭空间。" />
      <Text style={sharedStyles.label}>家庭空间地址</Text>
      <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={setServerUrl} placeholder="https://capsule.example.com" style={sharedStyles.input} value={serverUrl} />
      <Text style={sharedStyles.label}>邮箱</Text>
      <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} style={sharedStyles.input} value={email} />
      <Text style={sharedStyles.label}>密码</Text>
      <TextInput autoCapitalize="none" autoComplete="current-password" onChangeText={setPassword} secureTextEntry style={sharedStyles.input} value={password} />
      {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
      <Pressable disabled={busy} onPress={() => void submit()} style={sharedStyles.primaryButton}>
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={sharedStyles.primaryText}>登录</Text>}
      </Pressable>
    </View>
  );
}

/** 账号已建立但还没有家庭时的一次性初始化门（登录不再被误判失败）。 */
export function OnboardingGate() {
  const { completeOnboarding, disconnect, credentials } = useApp();
  const [familyName, setFamilyName] = useState("");
  const [childDisplayName, setChildDisplayName] = useState("");
  const [childBirthDate, setChildBirthDate] = useState("");
  const [selfDisplayName, setSelfDisplayName] = useState("");
  const [selfRelationToChild, setSelfRelationToChild] = useState("");
  const [selfIsGuardian, setSelfIsGuardian] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();

  const timezone = useMemo(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return tz && tz.length > 0 ? tz : "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  const submit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(childBirthDate.trim())) {
      setError("孩子的出生日期请按 2026-09-02 这样的格式填写。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding({
        familyName,
        timezone,
        childDisplayName,
        childBirthDate: childBirthDate.trim(),
        selfDisplayName,
        selfRelationToChild,
        selfIsGuardian,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "建立家庭失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[sharedStyles.screen, { paddingTop: insets.top + 18 }]}>
      <ScrollView contentContainerStyle={sharedStyles.content}>
        <StepHeader
          eyebrow="初始化家庭"
          title="建立你的家庭"
          intro={`以 ${credentials?.serverUrl ?? "家庭空间"} 管理员身份创建家庭、孩子和你的档案。家庭时区：${timezone}。`}
        />
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>家庭名称</Text>
          <TextInput onChangeText={setFamilyName} placeholder="例如：河边的小满家" style={sharedStyles.input} value={familyName} />
          <Text style={sharedStyles.label}>孩子的称呼</Text>
          <TextInput onChangeText={setChildDisplayName} placeholder="例如：小满" style={sharedStyles.input} value={childDisplayName} />
          <Text style={sharedStyles.label}>孩子的出生日期</Text>
          <TextInput onChangeText={setChildBirthDate} placeholder="2026-09-02" style={sharedStyles.input} value={childBirthDate} />
          <Text style={sharedStyles.label}>你的称呼</Text>
          <TextInput onChangeText={setSelfDisplayName} placeholder="例如：妈妈" style={sharedStyles.input} value={selfDisplayName} />
          <Text style={sharedStyles.label}>与孩子的关系</Text>
          <TextInput onChangeText={setSelfRelationToChild} placeholder="例如：妈妈" style={sharedStyles.input} value={selfRelationToChild} />
          <View style={styles.switchRow}>
            <Text style={sharedStyles.label}>我是孩子的监护人</Text>
            <Switch onValueChange={setSelfIsGuardian} value={selfIsGuardian} />
          </View>
        </View>
        {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
        <Pressable disabled={busy} onPress={() => void submit()} style={sharedStyles.primaryButton}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={sharedStyles.primaryText}>建立家庭并开始同步</Text>}
        </Pressable>
        <Pressable onPress={() => void disconnect()} style={styles.textButton}>
          <Text style={styles.plainLink}>换个账号</Text>
        </Pressable>
        <Text style={styles.note}>中断（断网、退出）不会丢失账号；重新登录后会回到这里继续。</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: 44, justifyContent: "center" },
  backText: { color: colors.coralDark, fontSize: 15, fontWeight: "800" },
  textButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  plainLink: { color: colors.coralDark, fontSize: 15, fontWeight: "700" },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  linkInput: { minHeight: 72, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
});
