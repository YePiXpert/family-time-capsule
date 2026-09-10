import { Text, TextInput } from "../components/typography";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  ApiError,
  acceptInvitation,
  bootstrapSetup,
  fetchBootstrap,
  parseInviteLink,
  previewInvitation,
  signIn,
} from "../api/client";
import { useApp } from "../state/AppContext";
import { useSharedStyles } from "../theme";
import type { JournalPalette } from "../design/tokens";
import { AccountLoginForm } from "../components/AccountLoginForm";
import type { BootstrapInfo, InvitationPreview } from "../types";

const ROLE_LABELS: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑",
  contributor: "记录者",
  viewer: "只读家人",
};

const PREVIEW_STATUS_LABELS: Record<string, string> = {
  claimed: "正在被接受",
  expired: "已过期",
  revoked: "已撤销",
  used: "已被使用",
};

function useThemedStyles() {
  const s = useSharedStyles();
  return useMemo(() => createStyles(s.colors), [s.colors]);
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 首次启动引导（1.3）：创建我的家庭 / 加入家人的家庭 / 暂时只在本机记录，
 * 次级入口“已有账号登录”。仅在无凭据且未处理过欢迎页时出现；
 * 已登录用户升级后直接进入主界面，不会重新看到本页。
 */

type Step = "welcome" | "create" | "join" | "login";

export function WelcomeFlow() {
  const s = useSharedStyles();
  const [step, setStep] = useState<Step>("welcome");
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.screen, { paddingTop: insets.top + 18 }]}>
      <ScrollView contentContainerStyle={[s.content, { flexGrow: 1 }]}>
        {step === "welcome" ? <WelcomeStep onChoose={setStep} /> : null}
        {step === "create" ? <CreateFamilyStep onBack={() => setStep("welcome")} /> : null}
        {step === "join" ? <JoinFamilyStep onBack={() => setStep("welcome")} /> : null}
        {step === "login" ? <LoginStep onBack={() => setStep("welcome")} /> : null}
      </ScrollView>
    </View>
  );
}

function StepHeader({ eyebrow, title, intro }: { eyebrow: string; title: string; intro: string }) {
  const s = useSharedStyles();
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text style={s.title}>{title}</Text>
      <Text style={s.intro}>{intro}</Text>
    </View>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  const styles = useThemedStyles();
  return (
    <Pressable onPress={onBack} style={styles.back}>
      <Text style={styles.backText}>← 返回</Text>
    </Pressable>
  );
}

function WelcomeStep({ onChoose }: { onChoose: (step: Step) => void }) {
  const s = useSharedStyles();
  const styles = useThemedStyles();
  const { setWelcomeSeen } = useApp();
  return (
    <View style={{ gap: 16, justifyContent: "center", flexGrow: 1 }}>
      <StepHeader
        eyebrow="小美成长记"
        title="从今天起，写下宝宝的成长"
        intro="记录保存在你自己的设备上；连接自托管的家庭空间后，才能与家人共享。这里没有官方云服务。"
      />
      <Pressable onPress={() => onChoose("create")} style={s.primaryButton}>
        <Text style={s.primaryText}>创建我的家庭</Text>
      </Pressable>
      <Pressable onPress={() => onChoose("join")} style={s.secondaryButton}>
        <Text style={s.secondaryText}>加入家人的家庭</Text>
      </Pressable>
      <Pressable onPress={() => void setWelcomeSeen()} style={s.secondaryButton}>
        <Text style={s.secondaryText}>暂时只在本机记录</Text>
      </Pressable>
      <Pressable onPress={() => onChoose("login")} style={styles.textButton}>
        <Text style={styles.plainLink}>已有账号登录</Text>
      </Pressable>
      <Text style={styles.note}>“创建我的家庭”需要家人空间管理员先在服务器上完成部署；之后可以随时在设置中连接。</Text>
    </View>
  );
}

function CreateFamilyStep({ onBack }: { onBack: () => void }) {
  const s = useSharedStyles();
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

  return (
    <View style={{ gap: 12 }}>
      <BackButton onBack={onBack} />
      <StepHeader
        eyebrow="创建我的家庭"
        title="连接家庭空间"
        intro="填写家人的自托管服务地址（管理员部署后获得），我们会先确认这是可用的小美成长记实例。"
      />
      <Text style={s.label}>家庭空间地址</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setServerUrl}
        placeholder="https://capsule.example.com"
        style={s.input}
        value={serverUrl}
      />
      <Pressable disabled={detecting} onPress={() => void detect()} style={s.primaryButton}>
        {detecting ? <ActivityIndicator color={s.colors.onCoral} /> : <Text style={s.primaryText}>检测家庭空间</Text>}
      </Pressable>
      {error ? <Text style={s.error}>{error}</Text> : null}

      {info ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>{info.serverUrl.replace(/^https?:\/\//u, "")}</Text>
          <Text style={s.body}>
            {info.info.setup.state === "available"
              ? "这是一个新部署的家庭空间，可以创建第一个管理员账号。"
              : info.info.setup.state === "completed"
                ? "该家庭空间已有管理员。若你就是管理员或家人，请直接登录；或联系管理员邀请你加入。"
                : "该服务器尚未配置初始化令牌（INITIAL_SETUP_TOKEN），请联系部署者在服务器上完成配置。"}
          </Text>
        </View>
      ) : null}

      {info && info.info.setup.state === "available" ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>创建管理员账号</Text>
          <Text style={s.label}>初始化令牌</Text>
          <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setToken} placeholder="部署时设置的 INITIAL_SETUP_TOKEN" style={s.input} value={token} />
          <Text style={s.label}>你的称呼</Text>
          <TextInput onChangeText={setDisplayName} placeholder="例如：妈妈" style={s.input} value={displayName} />
          <Text style={s.label}>邮箱（用于登录）</Text>
          <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} style={s.input} value={email} />
          <Text style={s.label}>密码（至少 10 位）</Text>
          <TextInput autoCapitalize="none" autoComplete="new-password" onChangeText={setPassword} secureTextEntry style={s.input} value={password} />
          <Text style={s.label}>确认密码</Text>
          <TextInput autoCapitalize="none" autoComplete="new-password" onChangeText={setPasswordConfirm} secureTextEntry style={s.input} value={passwordConfirm} />
          <Pressable disabled={submitting} onPress={() => void submitSetup()} style={s.primaryButton}>
            {submitting ? <ActivityIndicator color={s.colors.onCoral} /> : <Text style={s.primaryText}>创建账号并登录</Text>}
          </Pressable>
        </View>
      ) : null}

      {info && info.info.setup.state === "completed" ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>登录该家庭空间</Text>
          <AccountLoginForm key={info.serverUrl} serverUrl={info.serverUrl} onLogin={connect} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * 加入家庭（M2）：粘贴或扫码完整邀请链接 → 只读预览确认目标家庭 →
 * 在 App 内注册账号（原子接受邀请）→ 自动登录并绑定同一家庭。
 */
function JoinFamilyStep({ onBack }: { onBack: () => void }) {
  const s = useSharedStyles();
  const styles = useThemedStyles();
  const { connect } = useApp();
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [invite, setInvite] = useState<{ serverUrl: string; token: string } | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const startCheck = async (value: string) => {
    const parsed = parseInviteLink(value);
    if (!parsed) {
      setError("邀请链接必须以 https:// 开头并指向 /invite/… 路径。");
      setInvite(null);
      setPreview(null);
      return;
    }
    setError(null);
    setInvite(parsed);
    setChecking(true);
    try {
      setPreview(await previewInvitation(parsed.serverUrl, parsed.token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法查看邀请。");
      setPreview(null);
    } finally {
      setChecking(false);
    }
  };

  const startScan = async () => {
    if (!permission?.granted) {
      const asked = await requestPermission();
      if (!asked.granted) {
        setError("需要相机权限才能扫码；也可以直接粘贴邀请链接。");
        return;
      }
    }
    setScanning(true);
  };

  const submit = async () => {
    if (!invite || preview?.status !== "active") return;
    if (!displayName.trim() || !email.trim() || !password) {
      setError("请填写称呼、邮箱和密码。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await acceptInvitation(invite.serverUrl, {
        token: invite.token,
        displayName,
        email,
        password,
      });
      const credentials = await signIn(invite.serverUrl, email, password);
      await connect(credentials);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "注册失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  const active = preview?.status === "active";
  return (
    <View style={{ gap: 12 }}>
      <BackButton onBack={onBack} />
      <StepHeader
        eyebrow="加入家人的家庭"
        title="使用家人发来的邀请"
        intro="粘贴家人分享的完整邀请链接，或扫描家人在 App 中展示的二维码。"
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
        style={[s.input, styles.linkInput]}
        value={link}
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          disabled={checking}
          onPress={() => void startCheck(link)}
          style={[s.primaryButton, { flex: 1 }]}
        >
          {checking ? <ActivityIndicator color={s.colors.onCoral} /> : <Text style={s.primaryText}>查看邀请</Text>}
        </Pressable>
        <Pressable onPress={() => void startScan()} style={[s.secondaryButton, { flex: 1 }]}>
          <Text style={s.secondaryText}>{scanning ? "正在扫码…" : "扫描二维码"}</Text>
        </Pressable>
      </View>
      {scanning ? (
        <View style={styles.cameraBox}>
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(event) => {
              setScanning(false);
              setLink(event.data);
              void startCheck(event.data);
            }}
            style={styles.camera}
          />
          <Text style={styles.note}>对准家人 App 中展示的邀请二维码</Text>
        </View>
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {invite && preview && preview.status !== "invalid" ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>将加入：{preview.familyName}</Text>
          <Text style={s.body}>
            身份：{ROLE_LABELS[preview.role] ?? preview.role}
            {preview.personName ? `（关联家人档案：${preview.personName}）` : ""}
          </Text>
          <Text style={s.body}>
            {preview.status === "active"
              ? `有效期至 ${formatExpiry(preview.expiresAt)}`
              : `邀请状态：${PREVIEW_STATUS_LABELS[preview.status]}，不能再使用。`}
          </Text>
          {preview.email ? (
            <Text style={s.warning}>此邀请限定了邮箱 {preview.email}。</Text>
          ) : null}
        </View>
      ) : null}
      {preview?.status === "invalid" ? (
        <Text style={s.error}>邀请链接无效，请向家人重新获取。</Text>
      ) : null}

      {invite && active ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>设置你的账号</Text>
          <Text style={s.label}>你的称呼</Text>
          <TextInput onChangeText={setDisplayName} placeholder="例如：爸爸" style={s.input} value={displayName} />
          <Text style={s.label}>邮箱（用于登录）</Text>
          <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} placeholder="dad@example.com" style={s.input} value={email} />
          <Text style={s.label}>密码（至少 10 位）</Text>
          <TextInput autoCapitalize="none" autoComplete="new-password" onChangeText={setPassword} placeholder="至少 10 位" secureTextEntry style={s.input} value={password} />
          <Pressable disabled={submitting} onPress={() => void submit()} style={s.primaryButton}>
            {submitting ? <ActivityIndicator color={s.colors.onCoral} /> : <Text style={s.primaryText}>注册并加入家庭</Text>}
          </Pressable>
          <Text style={styles.note}>注册成功后会自动登录；该邮箱已有账号时请改用“已有账号登录”。</Text>
        </View>
      ) : null}
    </View>
  );
}

function LoginStep({ onBack }: { onBack: () => void }) {
  const { connect } = useApp();
  return (
    <View style={{ gap: 12 }}>
      <BackButton onBack={onBack} />
      <StepHeader eyebrow="已有账号" title="登录家庭空间" intro="使用已有的邮箱和密码登录自托管家庭空间。" />
      <AccountLoginForm onLogin={connect} />
    </View>
  );
}

/** 账号已建立但还没有家庭时的一次性初始化门（登录不再被误判失败）。 */
export function OnboardingGate() {
  const s = useSharedStyles();
  const styles = useThemedStyles();
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
    if (childBirthDate.trim() && !/^\d{4}-\d{2}-\d{2}$/u.test(childBirthDate.trim())) {
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
    <View style={[s.screen, { paddingTop: insets.top + 18 }]}>
      <ScrollView contentContainerStyle={s.content}>
        <StepHeader
          eyebrow="初始化家庭"
          title="建立你的家庭"
          intro={`以 ${credentials?.serverUrl ?? "家庭空间"} 管理员身份创建家庭和你的档案，孩子资料可稍后补充。家庭时区：${timezone}。`}
        />
        <View style={s.card}>
          <Text style={s.label}>家庭名称</Text>
          <TextInput onChangeText={setFamilyName} placeholder="例如：河边的小满家" style={s.input} value={familyName} />
          <Text style={s.label}>孩子的称呼（可跳过）</Text>
          <TextInput onChangeText={setChildDisplayName} placeholder="例如：小满" style={s.input} value={childDisplayName} />
          <Text style={s.label}>孩子的出生日期（可稍后补充）</Text>
          <TextInput onChangeText={setChildBirthDate} placeholder="2026-09-02" style={s.input} value={childBirthDate} />
          <Text style={s.label}>你的称呼</Text>
          <TextInput onChangeText={setSelfDisplayName} placeholder="例如：妈妈" style={s.input} value={selfDisplayName} />
          <Text style={s.label}>与孩子的关系</Text>
          <TextInput onChangeText={setSelfRelationToChild} placeholder="例如：妈妈" style={s.input} value={selfRelationToChild} />
          <View style={styles.switchRow}>
            <Text style={s.label}>我是孩子的监护人</Text>
            <Switch onValueChange={setSelfIsGuardian} value={selfIsGuardian} />
          </View>
        </View>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Pressable disabled={busy} onPress={() => void submit()} style={s.primaryButton}>
          {busy ? <ActivityIndicator color={s.colors.onCoral} /> : <Text style={s.primaryText}>建立家庭并开始同步</Text>}
        </Pressable>
        <Pressable onPress={() => void disconnect()} style={styles.textButton}>
          <Text style={styles.plainLink}>换个账号</Text>
        </Pressable>
        <Text style={styles.note}>中断（断网、退出）不会丢失账号；重新登录后会回到这里继续。</Text>
      </ScrollView>
    </View>
  );
}

function createStyles(palette: JournalPalette) {
  return StyleSheet.create({
  back: { minHeight: 44, justifyContent: "center" },
  backText: { color: palette.coralDark, fontSize: 15, fontWeight: "800" },
  textButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  plainLink: { color: palette.coralDark, fontSize: 15, fontWeight: "700" },
  note: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  linkInput: { minHeight: 72, textAlignVertical: "top" },
  cameraBox: { gap: 8 },
  camera: { height: 240, borderRadius: 12, overflow: "hidden" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  });
}
