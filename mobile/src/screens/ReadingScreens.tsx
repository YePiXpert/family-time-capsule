import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { NativeMediaReader } from "../media/NativeMediaReader";
import { useApp } from "../state/AppContext";
import { sharedStyles as s } from "../theme";
import type { RootStackParamList } from "../navigation/types";
import {
  nativeReadingStore,
  nativeReadingTransport,
  readingDownloads,
  readingFileUri,
  resolveReadingScope,
  clearReadingScope,
} from "../reading/native";
import type {
  DownloadEntry,
  DownloadSummary,
  ReadingScope,
  ReadingProgress,
} from "../reading/engine";
function Button({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[s.secondaryButton, disabled && s.disabled]}
      onPress={onPress}
    >
      <Text style={s.secondaryText}>{title}</Text>
    </Pressable>
  );
}
export function ReadingDownloadsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "ReadingDownloads">) {
  const { credentials, online: connected } = useApp(),
    [scope, setScope] = useState<ReadingScope | null>(null),
    [rows, setRows] = useState<DownloadSummary[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [globalBytes, setGlobalBytes] = useState(0),
    [online, setOnline] = useState(false);
  const refresh = useCallback(async () => {
    if (!scope) return;
    setRows(await nativeReadingStore.list(scope.key));
    setGlobalBytes(
      (await nativeReadingStore.list()).reduce(
        (n, r) => n + r.reservedBytes,
        0,
      ),
    );
  }, [scope]);
  useEffect(() => readingDownloads.subscribe(() => void refresh()), [refresh]);
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        try {
          if (!credentials) throw Error("连接原来的账号后查看其离线收藏。");
          const result = await resolveReadingScope(credentials, {
            offline: connected === false,
          });
          if (!mounted) return;
          setScope(result.scope);
          setOnline(result.online);
          const rows = await nativeReadingStore.list(result.scope.key);
          if (mounted) {
            setRows(rows);
            setGlobalBytes(
              (await nativeReadingStore.list()).reduce(
                (n, r) => n + r.reservedBytes,
                0,
              ),
            );
            setError("");
          }
        } catch (e) {
          if (mounted) {
            setRows([]);
            setError((e as Error).message);
          }
        }
      })();
      return () => {
        mounted = false;
      };
    }, [credentials, connected]),
  );
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await refresh();
    }
  }
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.title}>离线收藏</Text>
      <Text style={s.body}>
        {online
          ? "已连接家庭服务器"
          : "断网时可阅读已下载内容；联网后重新校验权限。"}
      </Text>
      <Text style={s.body}>
        当前连接{" "}
        {(rows.reduce((n, r) => n + r.reservedBytes, 0) / 1024 / 1024).toFixed(
          1,
        )}{" "}
        / 512 MiB；手机阅读缓存共 {(globalBytes / 1024 / 1024).toFixed(1)} /
        1024 MiB。
      </Text>
      <Text style={s.body}>
        清理仅删除阅读下载，保留本机唯一原件和待同步素材。暂停后保留已完成文件，未完成文件继续时重新下载。
      </Text>
      {error ? (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button title="刷新下载" onPress={() => void refresh()} />
      {!rows.length ? (
        <Text style={s.body}>在相册或作品页主动下载后，会出现在这里。</Text>
      ) : null}
      {rows.map((row) => (
        <View key={row.key} style={s.card}>
          <Text style={s.cardTitle}>{row.title}</Text>
          <Text style={s.body}>
            {
              {
                queued: "等待下载",
                downloading: "正在下载",
                paused: "已暂停",
                ready: "可离线阅读",
                failed: "下载失败",
              }[row.state]
            }{" "}
            ·{" "}
            {(
              (row.storedBytes + readingDownloads.transferProgress(row.key)) /
              1024 /
              1024
            ).toFixed(1)}{" "}
            / {(row.reservedBytes / 1024 / 1024).toFixed(1)} MB
          </Text>
          {row.error ? <Text style={s.error}>{row.error}</Text> : null}
          {row.state === "ready" ? (
            <Button
              title="阅读已下载内容"
              onPress={() =>
                navigation.navigate("OfflineReading", { key: row.key })
              }
            />
          ) : row.state === "downloading" ? (
            <Button
              title="暂停下载"
              onPress={() =>
                void perform(() => readingDownloads.pause(row.key))
              }
            />
          ) : (
            <Button
              title={row.state === "failed" ? "重试下载" : "继续下载"}
              disabled={busy || !scope || !credentials}
              onPress={() =>
                void perform(() =>
                  readingDownloads.resume(
                    scope!,
                    row.key,
                    nativeReadingTransport(credentials!, scope!),
                  ),
                )
              }
            />
          )}
          <Button
            title="清理这份下载"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                "清理阅读下载",
                `仅删除“${row.title}”的阅读副本。本机原件和待同步素材不受影响。`,
                [
                  { text: "保留", style: "cancel" },
                  {
                    text: "清理下载",
                    onPress: () =>
                      void perform(() =>
                        readingDownloads.remove(
                          row.key,
                          nativeReadingTransport(credentials!, scope!),
                        ),
                      ),
                  },
                ],
              )
            }
          />
        </View>
      ))}
      {rows.length && scope && credentials ? (
        <Button
          title="清理当前连接全部阅读下载"
          disabled={busy}
          onPress={() =>
            Alert.alert(
              "清理当前阅读缓存",
              "只清除此服务器、账号、家庭下的阅读下载，不触碰原件和待同步内容。",
              [
                { text: "保留", style: "cancel" },
                {
                  text: "清理",
                  onPress: () =>
                    void perform(() => clearReadingScope(scope, credentials)),
                },
              ],
            )
          }
        />
      ) : null}
    </ScrollView>
  );
}
export function OfflineReadingScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "OfflineReading">) {
  const { credentials, online: connected } = useApp(),
    key = route.params.key,
    [entry, setEntry] = useState<DownloadEntry | null>(null),
    [error, setError] = useState(""),
    [mode, setMode] = useState("正在校验阅读权限…"),
    [chapter, setChapter] = useState(0),
    [page, setPage] = useState(0),
    [mediaPage, setMediaPage] = useState(0);
  const scroll = useRef<ScrollView>(null),
    progress = useRef<ReadingProgress>({ chapter: 0, page: 0, media: {} });
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        try {
          if (!credentials) throw Error("请连接原来的账号。");
          const { scope, online } = await resolveReadingScope(credentials, {
            offline: connected === false,
          });
          const check = online
            ? await readingDownloads.revalidate(
                scope,
                key,
                nativeReadingTransport(credentials, scope),
              )
            : "offline";
          const doc = await nativeReadingStore.get(key);
          if (!doc || doc.state !== "ready" || doc.scope !== scope.key)
            throw Error("这份内容尚未下载完成。");
          if (!alive) return;
          progress.current = doc.progress;
          setChapter(
            Math.min(
              doc.progress.chapter,
              Math.max(0, doc.manifest.chapters.length - 1),
            ),
          );
          setPage(doc.progress.page);
          setEntry(doc);
          setMode(
            check === "offline"
              ? "离线阅读：上次校验通过的副本，联网后会重新校验权限。"
              : "已按当前权限校验。新版或失权来源会撤下旧缓存。",
          );
          setError("");
        } catch (e) {
          if (alive) {
            setEntry(null);
            setError((e as Error).message);
          }
        }
      })();
      return () => {
        alive = false;
      };
    }, [credentials, key, connected]),
  );
  useEffect(
    () =>
      readingDownloads.subscribe((removed) => {
        if (removed === key) {
          setEntry(null);
          setError("作品或权限变化，旧缓存已撤下。请重新下载。");
        }
      }),
    [key],
  );
  const savePosition = useCallback(
    (assetId: string, seconds: number) => {
      progress.current = {
        ...progress.current,
        media: { ...progress.current.media, [assetId]: seconds },
      };
      void readingDownloads.saveProgress(key, progress.current).catch(() => {});
    },
    [key],
  );
  function move(ch: number, pg: number) {
    setChapter(ch);
    setPage(pg);
    progress.current = { ...progress.current, chapter: ch, page: pg };
    void readingDownloads.saveProgress(key, progress.current).catch(() => {});
    scroll.current?.scrollTo({ y: 0, animated: false });
  }
  if (!entry)
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Text style={s.title}>离线阅读</Text>
        <Text style={s.error} accessibilityRole="alert">
          {error || mode}
        </Text>
        <Button title="返回离线收藏" onPress={() => navigation.goBack()} />
      </ScrollView>
    );
  const doc = entry.manifest,
    current = doc.chapters[chapter],
    blocks = current?.blocks.slice(page * 8, page * 8 + 8) ?? [],
    media = doc.media
      .filter((m) => m.type !== "image")
      .slice(mediaPage * 8, mediaPage * 8 + 8);
  return (
    <ScrollView ref={scroll} style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>
        {doc.audience === "family" ? "家庭可读版" : "当前用户私人阅读"} ·
        下载版本 {doc.revision}
      </Text>
      <Text style={s.title}>{doc.title}</Text>
      <Text style={s.body}>{doc.subtitle}</Text>
      <Text style={s.body}>{mode}</Text>
      <Text style={s.body}>
        照片保留完整原图比例。桌面精细裁切版式请查看 PDF；这里按章节流式阅读。
      </Text>
      <View style={s.card}>
        <Text style={s.cardTitle}>目录</Text>
        {doc.chapters.map((c, i) => (
          <Button
            key={c.id}
            title={`${i === chapter ? "✓ " : ""}${c.title}`}
            onPress={() => move(i, 0)}
          />
        ))}
      </View>
      <Text style={s.cardTitle}>{current?.title ?? "作品内容"}</Text>
      <Text style={s.body}>
        第 {chapter + 1} / {Math.max(1, doc.chapters.length)} 章 · 第 {page + 1}{" "}
        组内容
      </Text>
      {!blocks.length ? <Text style={s.body}>本章尚未选入内容。</Text> : null}
      {blocks.map((b) => (
        <View key={b.id} style={s.card}>
          {b.dateLabel ? <Text style={s.body}>{b.dateLabel}</Text> : null}
          {b.images.length ? (
            <NativeMediaReader
              credentials={null}
              assets={b.images.map((id) => {
                const m = doc.media.find((m) => m.id === id)!;
                return {
                  id: m.id,
                  type: m.type,
                  filename: b.caption || m.filename,
                  mimeType: m.mimeType,
                  localUri: readingFileUri(key, m),
                };
              })}
            />
          ) : null}
          {b.text ? (
            <Text style={[s.body, b.kind === "quote" && { fontSize: 19 }]}>
              {b.text}
            </Text>
          ) : null}
          {b.author ? <Text style={s.body}>—— {b.author}</Text> : null}
          {b.caption ? <Text style={s.body}>{b.caption}</Text> : null}
          <Text style={s.body}>来源：{b.sourceLabels.join("、")}</Text>
          {b.memoryEventId ? (
            <Button
              title="返回来源记忆"
              onPress={() =>
                navigation.navigate("Memory", { id: b.memoryEventId! })
              }
            />
          ) : null}
        </View>
      ))}
      <Button
        title="上一组内容"
        disabled={page === 0}
        onPress={() => move(chapter, page - 1)}
      />
      <Button
        title="下一组内容"
        disabled={!current || current.blocks.length <= (page + 1) * 8}
        onPress={() => move(chapter, page + 1)}
      />
      {media.length ? (
        <>
          <Text style={s.cardTitle}>随册声音、视频和文档</Text>
          <NativeMediaReader
            credentials={null}
            assets={media.map((m) => ({
              id: m.id,
              type: m.type,
              filename: m.filename,
              mimeType: m.mimeType,
              durationMs: m.durationMs,
              author: m.author ?? undefined,
              dateLabel: m.dateLabel,
              localUri: readingFileUri(key, m),
              localTranscript: m.transcript,
              initialSeconds: entry.progress.media[m.id] ?? 0,
            }))}
            onPosition={savePosition}
          />
          <Button
            title="上一组媒体"
            disabled={mediaPage === 0}
            onPress={() => setMediaPage(mediaPage - 1)}
          />
          <Button
            title="下一组媒体"
            disabled={
              doc.media.filter((m) => m.type !== "image").length <=
              (mediaPage + 1) * 8
            }
            onPress={() => setMediaPage(mediaPage + 1)}
          />
        </>
      ) : null}
    </ScrollView>
  );
}
