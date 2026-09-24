import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { getToken } from "../family/session";
import { BackupStopped } from "../local/backup";
import { useLibrary, useStore, useSyncStatus } from "../local/context";
import { useNav } from "../local/navigation";
import {
  Button,
  Card,
  ErrorText,
  Text,
  dateLabel,
  messageOf,
  useStyles,
} from "../local/ui";
import { keyIdOf } from "./crypto";
import { verifyRemoteBackup } from "./engine";
import { runFamilySync, startSharing } from "./family";
import { claimSync, markSyncRunning } from "./status";
import { dateTimeLabel } from "../local/dates";
import { bytesLabel } from "./planner";
import {
  clearSyncFiles,
  loadKey,
  readRemoteState,
  readConflicts,
  type RemoteState,
  unreadNotice,
} from "./state";
import { SyncError, createTransport, type RemoteStatus } from "./transport";
/** 备份页最后一张卡：家人一起写只管同步——开始、现在同步、冲突、核对远端；
 * 加入、退出家庭与恢复码都在「我的 → 家庭与设备」。
 * onRunningChange 与本机备份共用操作锁，避免同时读写 blob 库。
 */
export function FamilyCard({
  busy,
  onRunningChange,
}: {
  busy: boolean;
  onRunningChange?: (running: boolean) => void;
}) {
  const sync = useSyncStatus();
  const library = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles();
  // useState 槽位：signedIn、remote、progress、message、error、isOwner、conflicts、localKeyId、status、statusError。
  const [signedIn, setSignedIn] = useState<boolean | null>(null),
    [remote, setRemote] = useState<RemoteState | null>(null),
    [progress, setProgress] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [conflicts, setConflicts] = useState(0);
  const [localKeyId, setLocalKeyId] = useState<string | null>(null);
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    let cancelled = false;
    setIsOwner(false);
    setStatus(null);
    setStatusError("");
    setError("");
    void (async () => {
      try {
        const [token, state, items, key] = await Promise.all([
          getToken(),
          readRemoteState(),
          readConflicts(),
          loadKey(),
        ]);
        if (cancelled) return;
        setSignedIn(!!token);
        setRemote(state);
        setConflicts(items.length);
        setLocalKeyId(key ? keyIdOf(key) : null);
        if (token) {
          const transport = createTransport();
          await Promise.all([
            transport.me()
              .then((identity) => {
                if (!cancelled) setIsOwner(identity.role === "admin");
              })
              .catch((e: unknown) => {
                if (!cancelled) setError(messageOf(e));
              }),
            !state?.enabled
              ? transport.status()
                  .then((next) => {
                    if (!cancelled) setStatus(next);
                  })
                  .catch((e: unknown) => {
                    if (!cancelled) setStatusError(messageOf(e));
                  })
              : Promise.resolve(),
          ]);
        }
      } catch (e) {
        // 钥匙串读不出来：别让卡上的按钮全灰着不说话。
        if (cancelled) return;
        setSignedIn(false);
        setError(messageOf(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useFocusEffect(refresh);
  // 离开这一页就停止还在跑的同步：停止键跟着卡一起消失，不能让它在背后继续。
  useEffect(() => {
    const active = controller;
    return () => active.current?.abort();
  }, []);
  const running = !!progress;
  const syncing = running || sync.running;
  const perform = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (!claimSync()) {
      setMessage("正在同步，等它完成再试。");
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setMessage("");
    setProgress("正在准备…");
    onRunningChange?.(true);
    try {
      await fn(abort.signal);
    } catch (e) {
      // 「正在整理照片」阶段的停止来自本机备份（BackupStopped），之后的来自传输层。
      if (
        e instanceof BackupStopped ||
        (e instanceof SyncError && e.code === "CANCELED")
      )
        setMessage("已停止。");
      else setError(messageOf(e));
    } finally {
      markSyncRunning(false);
      controller.current = null;
      setProgress("");
      onRunningChange?.(false);
      try {
        setRemote(await readRemoteState());
        setConflicts((await readConflicts()).length);
      } catch (e) {
        setError(messageOf(e));
      }
    }
  };
  const withKey = async (
    signal: AbortSignal,
    fn: (key: Uint8Array, signal: AbortSignal) => Promise<void>,
  ) => {
    const key = await loadKey();
    if (!key)
      throw new Error("这台手机还没拿到家庭的钥匙，请到「我的 → 家庭与设备」重新加入。");
    await fn(key, signal);
  };
  const syncNow = () =>
    perform((signal) =>
      withKey(signal, async (key) => {
        const result = await runFamilySync(store, {
          transport: createTransport(),
          key,
          onProgress: setProgress,
          signal,
        });
        const { pulled = 0, pushed = 0, conflicts = 0 } =
          result.lastSyncSummary ?? {};
        const parts = [
          pulled > 0 ? `从家人那里并入 ${pulled} 处改动` : "",
          pushed > 0 ? `往远端新传 ${pushed} 份` : "",
          conflicts > 0 ? `${conflicts} 段两台手机都改过` : "",
        ].filter(Boolean);
        setMessage(
          [
            pulled === 0 && pushed === 0 && conflicts === 0
              ? "已经是最新的了。"
              : `同步完成：${parts.join("，")}。`,
            unreadNotice(result.lastSyncSummary),
          ].join(""),
        );
      }),
    );
  const records = Object.keys(library.records).length;
  const shareNow = () =>
    perform((signal) =>
      withKey(signal, async (key) => {
        const result = await startSharing(store, key, {
          transport: createTransport(),
          onProgress: setProgress,
          signal,
        });
        setMessage(`已开始一起写，同步完成。${unreadNotice(result.lastSyncSummary)}`);
      }),
    );
  /** 家里已经有人在写、这台又有自己的记录：先说清楚会共享，再开始（开始前自动留一份本机备份）。 */
  const share = () => {
    if (!status?.manifests || records === 0) return void shareNow();
    Alert.alert(
      "和家人一起写？",
      `这台手机上已有的 ${records} 段时光会和家人共享，开始前先在本机留一份备份；草稿仍只在这台手机上。`,
      [
        { text: "取消", style: "cancel" },
        { text: "开始", onPress: () => void shareNow() },
      ],
    );
  };
  const verify = () =>
    perform((signal) =>
      withKey(signal, async (key) => {
        const summary = await verifyRemoteBackup({
          transport: createTransport(),
          key,
          onProgress: setProgress,
          signal,
        });
        setMessage(
          `远端完整：${dateLabel(summary.createdAt)} 发布的这一份，${bytesLabel(summary.bytes)}，都在。`,
        );
      }),
    );
  const wipeFamily = () =>
    Alert.alert(
      "删掉全家的远端？",
      "这会删除全家所有手机发布到远端的内容，这台手机也停止同步。各台手机本机的时光都还在；家人的手机再同步时会重新传上去。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删掉全家的远端",
          style: "destructive",
          onPress: () => {
            void perform(async (signal) => {
              await createTransport().wipeFamily(signal);
              // 家庭的钥匙留着：它属于家庭，不属于远端；再开始一起写还用它。
              clearSyncFiles();
              setMessage("全家的远端已删除，这台手机已停止同步。");
              refresh();
            });
          },
        },
      ],
    );
  const stop = running && (
    <Button
      title="停止"
      kind="text"
      compact
      testID="remote-stop"
      onPress={() => controller.current?.abort()}
    />
  );
  return (
    <Card testID="remote-card">
      <Text style={s.heading}>家人一起写</Text>
      {signedIn === null ? (
        <Text style={s.muted}>正在读取…</Text>
      ) : signedIn === false ? (
        <>
          <Text style={s.muted}>
            加入家庭后，几台手机可以一起写这本册子：每段时光都有落款，照片和文字加密后经家人服务同步，同步存储的服务器看不到内容。
          </Text>
          <ErrorText message={error} />
          <View style={{ alignItems: "flex-start" }}>
            <Button
              title="去加入家庭"
              kind="text"
              compact
              testID="remote-family"
              disabled={busy || syncing}
              onPress={() => nav.navigate("Family")}
            />
          </View>
        </>
      ) : !remote?.enabled ? (
        <>
          <Text style={s.muted}>
            开始后，这台手机的时光会与家人的合在一起，各自的草稿留在各自的手机上。
          </Text>
          <ErrorText message={error} />
          {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
          {statusError ? (
            <>
              <ErrorText message={statusError} />
              <Button
                title="再试一次"
                kind="text"
                disabled={busy || syncing}
                onPress={() => { refresh(); }}
              />
            </>
          ) : !status ? (
            !error && <Text style={s.muted}>正在看看家里有没有人在写…</Text>
          ) : (
            <View style={s.row}>
              {!localKeyId ? (
                <Button
                  title="去家庭与设备"
                  testID="remote-family"
                  disabled={busy || syncing}
                  onPress={() => nav.navigate("Family")}
                />
              ) : status.keyId && status.keyId !== localKeyId ? (
                <ErrorText message="这台手机的钥匙和家里远端的对不上，请到「家庭与设备」退出后重新加入。" />
              ) : (
                <Button
                  title={status.manifests > 0 ? "加入一起写" : "开始一起写"}
                  testID={status.manifests > 0 ? "remote-resume" : "remote-enable"}
                  disabled={busy || syncing}
                  onPress={share}
                />
              )}
              {stop}
            </View>
          )}
        </>
      ) : (
        <>
          <Text style={s.muted}>
            {remote.lastSyncAt
              ? `上次同步 ${dateTimeLabel(remote.lastSyncAt)} · ${remote.lastSyncSummary?.devices ?? 1} 台手机 · ${bytesLabel(remote.lastSyncSummary?.bytes ?? 0)}`
              : "还没同步过。"}
          </Text>
          {!syncing && !!unreadNotice(remote.lastSyncSummary) && (
            <Text style={s.muted}>{unreadNotice(remote.lastSyncSummary)}</Text>
          )}
          <ErrorText message={error || (!syncing ? remote.lastError : "") || ""} />
          {conflicts > 0 && (
            <View style={s.between}>
              <Text>{`有 ${conflicts} 段两台手机都改过`}</Text>
              <Button
                title="去看看"
                kind="text"
                testID="remote-conflicts"
                disabled={busy || syncing}
                onPress={() => nav.navigate("Conflicts")}
              />
            </View>
          )}
          {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
          <View style={s.row}>
            <Button
              title={progress || (sync.running && !running ? "正在同步…" : "现在同步")}
              testID="remote-backup"
              disabled={busy || syncing}
              onPress={() => {
                void syncNow();
              }}
            />
            {stop}
          </View>
          <View style={s.row}>
            <Button
              title="验证远端"
              kind="text"
              compact
              testID="remote-verify"
              disabled={busy || syncing}
              onPress={() => {
                void verify();
              }}
            />
          </View>
          {isOwner && (
            <Button
              title="删掉全家的远端"
              kind="text"
              compact
              danger
              testID="remote-wipe-family"
              disabled={busy || syncing}
              onPress={wipeFamily}
            />
          )}
          <Text style={s.footnote}>
            钥匙指纹 {remote.keyId.slice(0, 8)}
            。钥匙只在获准的手机上；家庭恢复码在管理者手里。
          </Text>
        </>
      )}
    </Card>
  );
}
