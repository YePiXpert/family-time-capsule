import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { useLibrary, useStore } from "../local/context";
import { dateTimeLabel } from "../local/dates";
import type { Props } from "../local/navigation";
import {
  Button,
  Card,
  DangerCard,
  ErrorText,
  Field,
  FieldRow,
  Page,
  SettingsGroup,
  SettingsRow,
  Text,
  dateLabel,
  messageOf,
  useStyles,
  useTheme,
} from "../local/ui";
import { verifyRemoteBackup } from "../sync/engine";
import { leaveFamily, readNewestManifest, runFamilySync, startSharing } from "../sync/family";
import { bytesLabel } from "../sync/planner";
import { clearSyncFiles, loadKey, unreadNotice } from "../sync/state";
import { SyncCard } from "../sync/SyncCard";
import { claimSync, isLocalBusy, markSyncRunning } from "../sync/status";
import { SyncError, createTransport } from "../sync/transport";
import { createFamilyApi, FamilyError, type FamilyInfo, type Overview, type Role } from "./api";
import { forgetDeviceKey } from "./keys";
import {
  approveJoin,
  cancelJoin,
  completeFamilyStart,
  inspectJoin,
  pollJoin,
  prepareFamilyStart,
  recoverAsAdmin,
  recoveryAdmins,
  prepareRecovery,
  submitRecovery,
  type PreparedRecovery,
  requestToJoin,
  awaitingConfirm,
  upgradeFamily,
  type Inspected,
  type JoinRequest,
  type JoinedFamily,
  type PreparedFamilyStart,
} from "./pairing";
import { Qr } from "./Qr";
import { Scanner } from "./Scanner";
import { forgetToken, getToken } from "./session";
import { RecoveryWords } from "./Words";
/**
 * 「设置 → 家庭与同步」：一页走完开家庭、升级、出码加入、扫码批准、同步、恢复码、设备、管理者维护与退出。
 * 秘密（恢复词、二维码里的 S、领取凭据）只在这一页的内存里，不进导航参数、不落盘。
 */
type Step =
  | { kind: "loading" }
  | { kind: "out"; note?: string }
  | { kind: "upgrade" }
  | { kind: "home"; family: FamilyInfo; overview: Overview | null }
  | { kind: "start" }
  | { kind: "startWords"; prepared: PreparedFamilyStart }
  | { kind: "words"; words: string }
  | { kind: "regenWords"; prepared: PreparedRecovery }
  | { kind: "join" }
  | { kind: "qr"; join: JoinRequest }
  | { kind: "approved"; joined: JoinedFamily; recovered: boolean; readable: string | null }
  | { kind: "recover" }
  | { kind: "pick"; secret: Uint8Array; admins: { id: string; name: string }[] }
  | { kind: "scan"; round: number }
  | { kind: "approve"; inspected: Inspected }
  | { kind: "devices"; family: FamilyInfo; overview: Overview }
  | { kind: "maintain"; family: FamilyInfo };
export const roleLabel = (role: Role) => (role === "admin" ? "管理者" : "家人");
const defaultDeviceName = () => (Platform.OS === "ios" ? "iPhone" : "安卓手机");
const POLL_MS = 2500;
/** 与服务端的保护同一条规则：启用的管理者名下、已确认未停用的设备只剩这一台。 */
export function isLastAdminDevice(overview: Overview, deviceId: string, now = Date.now()): boolean {
  const admins = new Set(
    overview.members.filter((m) => m.role === "admin" && m.enabled).map((m) => m.id),
  );
  const active = overview.devices.filter(
    (d) => admins.has(d.member_id) && !d.revoked && !d.pending &&
      (d.last_used_at ?? d.created_at) >= now - 365 * 24 * 60 * 60 * 1000,
  );
  return active.length === 1 && active[0]!.id === deviceId;
}
export function deviceLine(device: Overview["devices"][number]): string {
  if (device.revoked) return "已停用";
  if (device.pending) return "已批准，等这台手机确认";
  return device.last_used_at
    ? `最后使用 ${dateTimeLabel(new Date(device.last_used_at).toISOString())}`
    : "还没用过";
}
export function FamilyScreen({ navigation }: Props<"Family">) {
  const store = useStore(),
    library = useLibrary(),
    s = useStyles(),
    { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [api] = useState(createFamilyApi);
  const [step, setStep] = useState<Step>({ kind: "loading" }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [progress, setProgress] = useState(""),
    [synced, setSynced] = useState(false);
  // 表单：开家庭、加入、找回、批准共用；切步骤时按需清空。
  const [code, setCode] = useState(""),
    [memberName, setMemberName] = useState(""),
    [deviceName, setDeviceName] = useState(defaultDeviceName()),
    [words, setWords] = useState(""),
    [choice, setChoice] = useState<"new" | "existing">("new"),
    [newName, setNewName] = useState(""),
    [newRole, setNewRole] = useState<Role>("member"),
    [existingId, setExistingId] = useState<string | null>(null);
  // 本机有家庭令牌：服务一时连不上时，身份卡报错，同步卡（只读本机状态）照常显示。
  const [signedIn, setSignedIn] = useState(false);
  const controller = useRef<AbortController | null>(null);
  /** 出了码、还没获准也没关掉的申请：离开这一页或点「不加入了」时撤掉。 */
  const openJoin = useRef<JoinRequest | null>(null);
  const records = Object.keys(library.records).length;
  const qrSize = Math.min(width - 72, 300);
  const load = useCallback(
    async (note?: string) => {
      try {
        const token = await getToken();
        setError("");
        setSignedIn(!!token);
        if (!token) {
          setStep({ kind: "out", note });
          return;
        }
        let family: FamilyInfo;
        try {
          family = await api.family();
        } catch (e) {
          if (e instanceof FamilyError && e.code === "FAMILY_MISSING") {
            setStep({ kind: "upgrade" });
            return;
          }
          if (e instanceof FamilyError && e.status === 401) {
            // 令牌已被停用或一年没用失效：留着只会让 AI 与同步一直报错。
            await forgetToken();
            setStep({
              kind: "out",
              note: "这台手机已被停用，或太久没用已经失效。请让管理者重新扫码加入。",
            });
            return;
          }
          throw e;
        }
        const overview = family.me.role === "admin" ? await api.overview() : null;
        setStep({ kind: "home", family, overview });
        if (note) setMessage(note);
      } catch (e) {
        setError(messageOf(e));
      }
    },
    [api],
  );
  useEffect(() => {
    // 先读本机钥匙串，再决定要不要问服务端。
    void getToken().then(
      () => load(),
      (e: unknown) => setError(messageOf(e)),
    );
    const active = controller,
      open = openJoin;
    return () => {
      active.current?.abort();
      // 离开这一页时还挂着的申请顺手撤掉，失败也无妨：10 分钟后自己过期。
      if (open.current) void cancelJoin({ api }, open.current).catch(() => undefined);
    };
  }, [api, load]);
  // 恢复码还没核对完就离开：说清楚后果，由人决定。
  useEffect(() => {
    if (step.kind !== "words" && step.kind !== "startWords" && step.kind !== "regenWords") return;
    const note =
      step.kind === "regenWords"
        ? "离开后这一套不会保留。还没交上去时，旧的那张纸照常能用；如果刚才提交报了错，服务可能已经换好，请先抄下这一套。"
        : "离开后这一页不会保留。请先抄好纸上的恢复码；如果家庭已经创建，用它可以找回。";
    return navigation.addListener("beforeRemove", (event) => {
      event.preventDefault();
      Alert.alert("恢复码还没核对完", note, [
        { text: "留下", style: "cancel" },
        { text: "离开", style: "destructive", onPress: () => navigation.dispatch(event.data.action) },
      ]);
    });
  }, [navigation, step.kind]);
  // 出码以后隔一会儿问一次批准了没有；过期、被取消就回到出码前。
  useEffect(() => {
    if (step.kind !== "qr") return;
    const join = step.join;
    const abort = new AbortController();
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      // 钥匙和令牌已经存好、只差确认（确认的回应丢了）：过了二维码的时限也要再确认一次，不能当作过期丢下。
      if (Date.parse(join.expiresAt) <= Date.now() && !awaitingConfirm(join)) {
        openJoin.current = null;
        setError("二维码过期了，请重新出示。");
        setStep({ kind: "join" });
        return;
      }
      try {
        const joined = await pollJoin({ api }, join, abort.signal);
        if (stopped) return;
        if (joined) {
          openJoin.current = null;
          setError("");
          setSynced(false);
          setStep({ kind: "approved", joined, recovered: false, readable: null });
          return;
        }
        setError("");
      } catch (e) {
        if (stopped) return;
        setError(messageOf(e));
        // 网络一时不通、服务一时出错就接着等（确认的回应丢了，下一次用存好的令牌再确认，见 pollJoin）；
        // 其余（被取消、过期、解不开、钥匙串写不进）停下来让人看清楚。
        if (!(e instanceof FamilyError && (e.code === "NETWORK" || (e.status ?? 0) >= 500))) {
          if (e instanceof FamilyError && (e.status === 404 || e.status === 409 || e.status === 410)) {
            openJoin.current = null;
            setStep({ kind: "join" });
          }
          return;
        }
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [api, step]);
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    // busy 要等下一次渲染才变；同一帧连点两下时靠 controller 挡住第二下，免得它接管停止键。
    if (busy || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn(abort.signal);
    } catch (e) {
      if (e instanceof SyncError && e.code === "CANCELED") setMessage("已停止。");
      else setError(messageOf(e));
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy(false);
      setProgress("");
    }
  };
  const go = (next: Step) => {
    setError("");
    setMessage("");
    setStep(next);
  };
  const firstSync = (key: Uint8Array) =>
    run(async (signal) => {
      if (isLocalBusy()) throw new Error("本机正在备份或恢复，等它完成再试。");
      if (!claimSync()) throw new Error("正在同步，等它完成再试。");
      try {
        const result = await startSharing(store, key, {
          transport: createTransport(),
          onProgress: setProgress,
          signal,
        });
        setSynced(true);
        setMessage(
          `第一次同步完成，${result.lastSyncSummary?.devices ?? 1} 台手机在一起写。${unreadNotice(result.lastSyncSummary)}`,
        );
      } finally {
        markSyncRunning(false);
      }
    });
  const readRecovered = async (joined: JoinedFamily, signal: AbortSignal) => {
    setProgress("正在解开远端最新的一份…");
      const newest = await readNewestManifest({ transport: createTransport(), key: joined.key, signal });
      setStep({
        kind: "approved",
        joined,
        recovered: true,
        readable: newest
          ? `已解开${newest.deviceName ? `「${newest.deviceName}」` : ""} ${dateTimeLabel(newest.createdAt)} 发布的那一份，内容都读得出来。`
          : "远端还没有内容，没什么要解开的。",
    });
  };
  const verifyRecovered = (joined: JoinedFamily) =>
    run((signal) => readRecovered(joined, signal));
  const leave = (family: FamilyInfo, overview: Overview | null) =>
    Alert.alert(
      "退出这个家庭？",
      "这台手机会忘掉家庭的钥匙、不再同步、不能用 AI；本机的时光和照片都留着。远端只撤下这台手机发布的那一份。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "退出",
          style: "destructive",
          onPress: () =>
            void run(async (signal) => {
              // 撤下清单之后服务才判能不能退：页上那份设备表可能是旧的，先拿最新的核一遍，别撤了清单再被拒。
              const current = overview ? await api.overview() : null;
              if (current && isLastAdminDevice(current, family.me.deviceId))
                throw new FamilyError(
                  "LAST_ADMIN_DEVICE",
                  "这是家里最后一台管理者手机。先给自己或另一位家人加一台管理者手机，再退出。",
                );
              // 被拒时要马上把清单发回去（见 republish）：本机正在备份、恢复或清理时先别退。
              if (isLocalBusy()) throw new Error("本机正在备份或恢复，等它完成再试。");
              if (!claimSync()) throw new Error("正在同步，等它完成再试。");
              try {
                await leaveFamily({
                  transport: createTransport(),
                  signal,
                  revokeDevice: () => api.leave(),
                  // 还是没让退：马上把这台的那一份发回去，家人那边不缺它。
                  republish: async () => {
                    const key = await loadKey();
                    if (key) await runFamilySync(store, { transport: createTransport(), key, signal });
                  },
                });
                await forgetToken();
                await forgetDeviceKey();
              } finally {
                markSyncRunning(false);
              }
              await load("已退出家庭。本机的时光和照片都留着。");
            }),
        },
      ],
    );
  /** 维护动作与同步共用一把锁：验证远端、清空远端都不能和同步、本机备份同时跑。 */
  const exclusive = (fn: (signal: AbortSignal) => Promise<void>) =>
    run(async (signal) => {
      if (isLocalBusy()) throw new Error("本机正在备份或恢复，等它完成再试。");
      if (!claimSync()) throw new Error("正在同步，等它完成再试。");
      try {
        await fn(signal);
      } finally {
        markSyncRunning(false);
      }
    });
  const verifyRemote = () =>
    exclusive(async (signal) => {
      const key = await loadKey();
      if (!key) throw new Error("这台手机还没拿到家庭的钥匙，请退出家庭后重新加入。");
      const summary = await verifyRemoteBackup({
        transport: createTransport(),
        key,
        onProgress: setProgress,
        signal,
      });
      setMessage(
        `远端完整：${dateLabel(summary.createdAt)} 发布的这一份，${bytesLabel(summary.bytes)}，都在。`,
      );
    });
  const wipeFamily = () =>
    Alert.alert(
      "删掉全家的远端？",
      "这会删除全家所有手机发布到远端的内容，这台手机也停止同步。各台手机本机的时光都还在；家人的手机再同步时会重新传上去。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删掉全家的远端",
          style: "destructive",
          onPress: () =>
            void exclusive(async (signal) => {
              await createTransport().wipeFamily(signal);
              // 家庭的钥匙留着：它属于家庭，不属于远端；再开始同步还用它。
              clearSyncFiles();
              setMessage("全家的远端已删除，这台手机已停止同步。");
            }),
        },
      ],
    );
  const memberActions = (member: Overview["members"][number]) =>
    Alert.alert(`${member.name} · ${roleLabel(member.role)}`, member.enabled ? undefined : "已停用", [
      {
        text: member.role === "admin" ? "改为家人" : "设为管理者",
        onPress: () =>
          void run(async () => {
            await api.setProfile(member.id, {
              name: member.name,
              role: member.role === "admin" ? "member" : "admin",
            });
            await load();
          }),
      },
      {
        text: member.enabled ? "停用（名下手机都失效）" : "重新启用",
        style: member.enabled ? "destructive" : "default",
        onPress: () =>
          void run(async () => {
            await api.setEnabled(member.id, {
              enabled: !member.enabled,
              photoLimit: member.photo_limit,
              writeLimit: member.write_limit,
            });
            await load();
          }),
      },
      { text: "取消", style: "cancel" },
    ]);
  const status = (
    <>
      <ErrorText message={error} />
      {!!(progress || message) && (
        <Text accessibilityLiveRegion="polite">{progress || message}</Text>
      )}
    </>
  );
  const back = (label = "返回") => (
    <Button title={label} kind="text" disabled={busy} onPress={() => void load()} />
  );
  let body: React.ReactNode;
  switch (step.kind) {
    case "loading":
      body = (
        <>
          <Card>
            {error ? (
              <>
                <ErrorText message={error} />
                <Button title="再试一次" onPress={() => void load()} />
              </>
            ) : (
              <Text style={s.muted}>正在读取…</Text>
            )}
          </Card>
          {!!error && signedIn && <SyncCard busy={busy} />}
        </>
      );
      break;
    case "out":
      body = (
        <Card testID="family-out">
          <Text style={s.heading}>还没加入家庭</Text>
          <Text style={s.muted}>
            家人的手机由管理者当面扫码加进来，不用注册，也不用记密码。加入后可以一起写这本册子，也能用 AI。
          </Text>
          {!!step.note && <Text>{step.note}</Text>}
          {status}
          <Button title="加入已有家庭" primary testID="family-join" onPress={() => go({ kind: "join" })} />
          <View style={s.row}>
            <Button title="开始一个家庭" kind="text" testID="family-start" onPress={() => go({ kind: "start" })} />
            <Button title="用恢复码找回" kind="text" testID="family-recover" onPress={() => go({ kind: "recover" })} />
          </View>
        </Card>
      );
      break;
    case "upgrade":
      body = (
        <Card testID="family-upgrade">
          <Text style={s.heading}>升级为家庭管理者</Text>
          <Text style={s.muted}>
            这台是原来的主人手机。升级后，家人的手机由你当面扫码加进来，不再用用户名和密码；你会拿到一套新的 12 个词的恢复码，原来那套作废。
          </Text>
          {status}
          <Button
            title={busy ? "正在升级…" : "升级"}
            primary
            testID="family-upgrade-start"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const done = await upgradeFamily({ api });
                go({ kind: "words", words: done.words });
              })
            }
          />
        </Card>
      );
      break;
    case "start":
      body = (
        <Card testID="family-start-form">
          <Text style={s.heading}>开始一个家庭</Text>
          <Text style={s.muted}>激活码由部署服务的人给你，24 小时内有效、只能用一次。你会成为这个家庭的管理者。</Text>
          <View>
            <FieldRow
              label="激活码"
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="XXXXX-XXXXX-…"
              testID="family-activation"
            />
            <FieldRow label="称呼" value={memberName} onChangeText={setMemberName} placeholder="例如 爸爸" testID="family-member-name" />
            <FieldRow label="手机名" value={deviceName} onChangeText={setDeviceName} testID="family-device-name" last />
          </View>
          {status}
          <View style={s.row}>
            <Button
              title={busy ? "正在开始…" : "开始"}
              primary
              testID="family-start-submit"
              disabled={busy || !code.trim() || !memberName.trim() || !deviceName.trim()}
              onPress={() =>
                void run(async () => {
                  const prepared = await prepareFamilyStart(
                    { api },
                    { activationCode: code, memberName, deviceName },
                  );
                  setCode("");
                  go({ kind: "startWords", prepared });
                })
              }
            />
            {back("取消")}
          </View>
        </Card>
      );
      break;
    case "startWords":
      body = (
        <>
          <RecoveryWords
            words={step.prepared.words}
            busy={busy}
            submitError={error}
            confirmTitle={busy ? "正在开始…" : "核对并开始家庭"}
            onDone={() =>
              void run(async () => {
                await completeFamilyStart({ api }, step.prepared);
                await load("家庭已开始，恢复码已核对。请把那张纸收好。");
              })
            }
          />
          {!!error && (
            <>
              <Text style={s.muted}>服务可能已经建好家庭。如果刚才没能完成，可以用纸上这套恢复码找回。</Text>
              <Button
                title="用刚抄下的恢复码找回"
                kind="text"
                testID="family-start-recover"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    const { secret, admins } = await recoveryAdmins({ api }, step.prepared.words);
                    go({ kind: "pick", secret, admins });
                  })
                }
              />
            </>
          )}
        </>
      );
      break;
    case "words":
      body = (
        <RecoveryWords
          words={step.words}
          onDone={() => {
            setStep({ kind: "loading" });
            void load("恢复码已核对。请把那张纸收好。");
          }}
        />
      );
      break;
    case "regenWords":
      body = (
        <>
          <RecoveryWords
            words={step.prepared.words}
            busy={busy}
            submitError={error}
            confirmTitle={busy ? "正在更换…" : "核对并换成这一套"}
            onDone={() =>
              void run(async () => {
                await submitRecovery({ api }, step.prepared);
                await load("恢复码已换成新的一套，旧的那张纸作废了。请把新的收好。");
              })
            }
          />
          {!!error && (
            <Text style={s.muted}>
              服务可能已经换好了。再点一次上面的按钮即可，交的是同一套；在看到「已换成新的一套」之前，别丢掉旧的那张纸。
            </Text>
          )}
        </>
      );
      break;
    case "join":
      body = (
        <Card testID="family-join-form">
          <Text style={s.heading}>加入已有家庭</Text>
          <Text style={s.muted}>
            {records > 0
              ? `加入后，这台手机上已有的 ${records} 段时光会和家人共享（第一次同步前先在本机留一份备份）；草稿仍只在这台手机上。`
              : "出示二维码后，请管理者用他的手机扫一扫。"}
          </Text>
          <View>
            <FieldRow label="手机名" value={deviceName} onChangeText={setDeviceName} testID="family-device-name" last />
          </View>
          {status}
          <View style={s.row}>
            <Button
              title={busy ? "正在准备…" : "出示二维码"}
              primary
              testID="family-show-qr"
              disabled={busy || !deviceName.trim()}
              onPress={() =>
                void run(async () => {
                  const join = await requestToJoin({ api }, deviceName);
                  openJoin.current = join;
                  go({ kind: "qr", join });
                })
              }
            />
            {back("取消")}
          </View>
        </Card>
      );
      break;
    case "qr":
      body = (
        <Card testID="family-qr-card">
          <Text style={s.heading}>请管理者扫这个码</Text>
          <View style={{ alignItems: "center" }}>
            <Qr text={step.join.qr} size={qrSize} />
          </View>
          <Text style={s.muted}>
            {`「${step.join.deviceName}」· 10 分钟内有效。管理者批准后，这里会自动显示「已获准」。只给身边的家人扫，不要截图转发。`}
          </Text>
          <ErrorText message={error} />
          {error ? (
            <Button title="再看一次" onPress={() => go({ kind: "qr", join: step.join })} />
          ) : null}
          <Button
            title="不加入了"
            kind="text"
            testID="family-qr-cancel"
            onPress={() => {
              const open = openJoin.current;
              openJoin.current = null;
              if (open) void cancelJoin({ api }, open).catch(() => undefined);
              void load();
            }}
          />
        </Card>
      );
      break;
    case "approved": {
      const { joined } = step;
      body = (
        <Card testID="family-approved">
          <Text style={s.heading}>{step.recovered ? "已找回" : "已获准"}</Text>
          <Text>{`你是「${joined.member.name}」（${roleLabel(joined.member.role)}），这台手机已加入家庭。`}</Text>
          {step.recovered && !step.readable ? (
            <>
              <Text style={s.muted}>还要真解开远端的一份才算找回。</Text>
              {status}
              <Button
                title="解开远端核对"
                primary
                testID="family-recover-verify"
                disabled={busy}
                onPress={() => void verifyRecovered(joined)}
              />
            </>
          ) : synced ? (
            <>
              {status}
              {step.recovered && (
                <Text style={s.muted}>
                  建议现在就到「设备」里停用丢了的手机，再重新生成一套恢复码。
                </Text>
              )}
              <Button title="好" primary testID="family-approved-done" onPress={() => void load()} />
            </>
          ) : (
            <>
              {!!step.readable && <Text style={s.muted}>{step.readable}</Text>}
              <Text style={s.muted}>
                {records > 0
                  ? `第一次同步会把这台手机上已有的 ${records} 段时光和家人的合在一起，开始前先在本机留一份备份；草稿仍只在这台手机上。`
                  : "第一次同步会把家人的时光和照片下载到这台手机，建议连着 Wi‑Fi。"}
              </Text>
              {status}
              <View style={s.row}>
                <Button
                  title={busy ? "正在同步…" : "开始第一次同步"}
                  primary
                  testID="family-first-sync"
                  disabled={busy}
                  onPress={() => void firstSync(joined.key)}
                />
                {busy ? (
                  <Button title="停止" kind="text" onPress={() => controller.current?.abort()} />
                ) : (
                  back("以后再说")
                )}
              </View>
            </>
          )}
        </Card>
      );
      break;
    }
    case "recover":
      body = (
        <Card testID="family-recover-form">
          <Text style={s.heading}>用恢复码找回</Text>
          <Text style={s.muted}>
            所有管理者的手机都没了时用：输入管理者抄在纸上的 12 个英文词，这台手机会成为一台新的管理者手机。
          </Text>
          <Field
            label="恢复码"
            placeholder="12 个英文词，用空格隔开"
            value={words}
            onChangeText={setWords}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            testID="family-recover-words"
          />
          <View>
            <FieldRow label="手机名" value={deviceName} onChangeText={setDeviceName} last />
          </View>
          {status}
          <View style={s.row}>
            <Button
              title={busy ? "正在核对…" : "下一步"}
              primary
              testID="family-recover-next"
              disabled={busy || !words.trim() || !deviceName.trim()}
              onPress={() =>
                void run(async () => {
                  const { secret, admins } = await recoveryAdmins({ api }, words);
                  setWords("");
                  go({ kind: "pick", secret, admins });
                })
              }
            />
            {back("取消")}
          </View>
        </Card>
      );
      break;
    case "pick":
      body = (
        <Card testID="family-recover-pick">
          <Text style={s.heading}>你是哪一位？</Text>
          <Text style={s.muted}>恢复码对上了。选你自己，这台手机会登记在你名下。</Text>
          {status}
          {step.admins.map((admin) => (
            <Button
              key={admin.id}
              title={admin.name}
              disabled={busy}
              onPress={() =>
                void run(async (signal) => {
                  const joined = await recoverAsAdmin({ api }, step.secret, admin.id, deviceName);
                  setSynced(false);
                  setStep({ kind: "approved", joined, recovered: true, readable: null });
                  await readRecovered(joined, signal);
                })
              }
            />
          ))}
          {back("取消")}
        </Card>
      );
      break;
    case "scan":
      body = (
        <Card testID="family-scan">
          <Text style={s.heading}>扫家人手机上的二维码</Text>
          <Text style={s.muted}>请对方在自己手机上点「设置 → 家庭与同步 → 加入已有家庭」。</Text>
          {error ? (
            <>
              {status}
              <Button title="再扫一次" onPress={() => go({ kind: "scan", round: step.round + 1 })} />
            </>
          ) : busy ? (
            <Text style={s.muted}>正在核对…</Text>
          ) : (
            <Scanner
              key={step.round}
              size={qrSize}
              onScanned={(text) =>
                void run(async () => {
                  const inspected = await inspectJoin({ api }, text);
                  setChoice("new");
                  setNewName("");
                  setNewRole("member");
                  setExistingId(null);
                  go({ kind: "approve", inspected });
                })
              }
            />
          )}
          {back("取消")}
        </Card>
      );
      break;
    case "approve": {
      const { pending, family } = step.inspected;
      body = (
        <Card testID="family-approve">
          <Text style={s.heading}>{`「${pending.deviceName}」申请加入`}</Text>
          <View style={s.row}>
            <Button title="新增一位家人" selected={choice === "new"} compact onPress={() => setChoice("new")} />
            <Button title="给已有家人加手机" selected={choice === "existing"} compact onPress={() => setChoice("existing")} />
          </View>
          {choice === "new" ? (
            <>
              <View>
                <FieldRow label="称呼" value={newName} onChangeText={setNewName} placeholder="例如 妈妈" testID="family-new-name" last />
              </View>
              <View style={s.row}>
                <Button title="家人" selected={newRole === "member"} compact onPress={() => setNewRole("member")} />
                <Button title="管理者" selected={newRole === "admin"} compact onPress={() => setNewRole("admin")} />
              </View>
              <Text style={s.footnote}>管理者可以批准新手机、停用设备、换恢复码。</Text>
            </>
          ) : (
            <View style={s.row}>
              {family.members.map((m) => (
                <Button
                  key={m.id}
                  title={`${m.name} · ${roleLabel(m.role)}`}
                  selected={existingId === m.id}
                  compact
                  onPress={() => setExistingId(m.id)}
                />
              ))}
            </View>
          )}
          {status}
          <View style={s.row}>
            <Button
              title={busy ? "正在批准…" : "批准"}
              primary
              testID="family-approve-submit"
              disabled={busy || (choice === "new" ? !newName.trim() : !existingId)}
              onPress={() =>
                void run(async () => {
                  await approveJoin(
                    { api },
                    step.inspected,
                    choice === "new"
                      ? { kind: "new", name: newName, role: newRole }
                      : { kind: "existing", memberId: existingId! },
                  );
                  await load(`已批准「${pending.deviceName}」。对方手机上显示「已获准」后，就可以开始第一次同步。`);
                })
              }
            />
            <Button
              title="拒绝"
              kind="text"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await api.cancelPairAsAdmin(pending.requestId);
                  await load("已拒绝这条申请。");
                })
              }
            />
          </View>
        </Card>
      );
      break;
    }
    case "devices": {
      const { overview, family } = step;
      const nameOf = (id: string) => overview.members.find((m) => m.id === id)?.name ?? "";
      const live = overview.devices.filter((d) => !d.revoked);
      const stopped = overview.devices.length - live.length;
      body = (
        <>
          <Card testID="family-devices">
            <Text style={s.heading}>设备</Text>
            <Text style={s.muted}>停用后那台手机马上不能同步、不能用 AI；已经在它上面的内容收不回。</Text>
            {status}
            <View>
              {live.map((device, i) => (
                <View
                  key={device.id}
                  style={[
                    s.between,
                    { minHeight: 56, paddingVertical: 8, gap: 12 },
                    i < live.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
                  ]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text>{`${nameOf(device.member_id)} · ${device.name}${device.id === family.me.deviceId ? "（这台）" : ""}`}</Text>
                    <Text style={s.muted}>{deviceLine(device)}</Text>
                  </View>
                  {device.id !== family.me.deviceId && (
                    <Button
                      title="停用"
                      kind="text"
                      danger
                      compact
                      disabled={busy}
                      onPress={() =>
                        Alert.alert(`停用「${device.name}」？`, "它马上不能同步、不能用 AI；要再用得重新扫码批准。", [
                          { text: "取消", style: "cancel" },
                          {
                            text: "停用",
                            style: "destructive",
                            onPress: () =>
                              void run(async () => {
                                await api.revokeDevice(device.id);
                                const next = await api.overview();
                                setStep({ kind: "devices", family, overview: next });
                              }),
                          },
                        ])
                      }
                    />
                  )}
                </View>
              ))}
            </View>
          </Card>
          {stopped > 0 && <Text style={s.footnote}>{`另有 ${stopped} 台已停用。`}</Text>}
          {back()}
        </>
      );
      break;
    }
    case "maintain": {
      const { family } = step;
      body = (
        <>
          <Card testID="family-maintain">
            <Text style={s.heading}>管理者维护</Text>
            <Text style={s.muted}>排查问题时才用，平时不用管。</Text>
            {status}
            <View style={{ alignItems: "flex-start" }}>
              <Button
                title={busy ? "正在验证…" : "验证远端"}
                kind="text"
                testID="remote-verify"
                disabled={busy}
                onPress={() => void verifyRemote()}
              />
              <Button
                title="重新生成恢复码"
                kind="text"
                testID="family-regenerate"
                disabled={busy}
                onPress={() =>
                  Alert.alert("重新生成恢复码？", "先抄下新的一套并核对，核对后才生效，纸上那套旧的随之作废。", [
                    { text: "取消", style: "cancel" },
                    {
                      text: "重新生成",
                      onPress: () =>
                        void run(async () => {
                          go({ kind: "regenWords", prepared: await prepareRecovery({ api }) });
                        }),
                    },
                  ])
                }
              />
            </View>
            <Text style={s.footnote}>
              {`家庭钥匙指纹 ${family.keyId.slice(0, 8)}。钥匙只在获准的手机上；家庭恢复码在管理者手里。`}
            </Text>
          </Card>
          <DangerCard title="删掉全家的远端" testID="remote-wipe-family" disabled={busy} onPress={wipeFamily} />
          {back()}
        </>
      );
      break;
    }
    case "home": {
      const { family, overview } = step;
      const admin = family.me.role === "admin";
      const rows = overview?.members ?? family.members.map((m) => ({ ...m, enabled: m.enabled ? 1 : 0, photo_limit: 0, write_limit: 0 }));
      body = (
        <>
          <Card testID="family-home">
            <Text style={s.heading}>{`${family.me.name} · ${roleLabel(family.me.role)}`}</Text>
            <Text style={s.muted}>这台手机已加入家庭。家人的手机由管理者当面扫码加进来。</Text>
            {status}
            {admin && (
              <View style={s.row}>
                <Button
                  title="添加一台手机"
                  icon="plus"
                  testID="family-add"
                  disabled={busy}
                  onPress={() => go({ kind: "scan", round: 0 })}
                />
                <Button
                  title="设备"
                  kind="text"
                  testID="family-devices-open"
                  disabled={busy || !overview}
                  onPress={() => overview && go({ kind: "devices", family, overview })}
                />
                <Button
                  title="维护"
                  kind="text"
                  testID="family-maintain-open"
                  disabled={busy}
                  onPress={() => go({ kind: "maintain", family })}
                />
              </View>
            )}
          </Card>
          <SyncCard busy={busy} />
          <SettingsGroup title="家人">
            {rows.map((m, i) => (
              <SettingsRow
                key={m.id}
                icon="person"
                label={m.name}
                subtitle={`${roleLabel(m.role)}${m.enabled ? "" : " · 已停用"}${m.id === family.me.memberId ? " · 我" : ""}`}
                onPress={admin && overview ? () => memberActions(m) : undefined}
                last={i === rows.length - 1}
              />
            ))}
          </SettingsGroup>
          <DangerCard title="退出这个家庭" testID="family-leave" disabled={busy} onPress={() => leave(family, overview)} />
        </>
      );
      break;
    }
  }
  return (
    <Page title="家庭与同步" testID="family-page">
      {body}
    </Page>
  );
}
