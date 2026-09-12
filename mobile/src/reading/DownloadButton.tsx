import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "../components/typography";
import { useNavigation } from "@react-navigation/native";
import type { AppNavigation } from "../navigation/types";
import { useAppData } from "../state/AppContext";
import { useConfirmSheet } from "../components/GlassSheet";
import { useSharedStyles } from "../theme";
import type { ReadingKind } from "./types";
import {
  nativeReadingTransport,
  readingDownloads,
  resolveReadingScope,
} from "./native";
export function ReadingDownloadButton({
  kind,
  id,
  prepare,
}: {
  kind: ReadingKind;
  id: string;
  prepare?: () => Promise<boolean>;
}) {
  const s = useSharedStyles();
  const { credentials, online: connected } = useAppData(),
    navigation = useNavigation<AppNavigation>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const confirm = useConfirmSheet();
  async function inspect() {
    if (!credentials) return;
    setBusy(true);
    setError("");
    try {
      if (prepare && !(await prepare())) return;
      const { scope, online } = await resolveReadingScope(credentials, {
        offline: connected === false,
      });
      if (!online) throw Error("连接服务器后可以添加新的阅读下载。");
      const transport = nativeReadingTransport(credentials, scope),
        manifest = await transport.manifest(kind, id),
        counts = manifest.media.reduce(
          (counts, m) => ({ ...counts, [m.type]: (counts[m.type] ?? 0) + 1 }),
          {} as Record<string, number>,
        );
      const accepted = await confirm({
        title: "下载供离线阅读",
        message: `${manifest.title}\n预计 ${(manifest.bytes / 1024 / 1024).toFixed(1)} MB；${manifest.chapters.length} 章，${counts.image ?? 0} 张照片、${counts.audio ?? 0} 段音频、${counts.video ?? 0} 段视频、${counts.document ?? 0} 份文档。\n只包含当前读者可见内容。每个连接配额 512 MiB；清理下载不删除本机原件或待同步素材。\n离线时不能立即获知远程撤权，联网校验后撤下失权缓存。`,
        confirmLabel: "下载",
        cancelLabel: "暂不下载",
      });
      if (!accepted) return;
      void readingDownloads
        .queue(scope, manifest, transport)
        .then((entry) => {
          navigation.navigate("ReadingDownloads");
          void readingDownloads
            .resume(scope, entry.key, transport)
            .catch(() => {});
        })
        .catch((e) => setError((e as Error).message));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      {error ? (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !credentials}
        style={[s.secondaryButton, busy && s.disabled]}
        onPress={() => void inspect()}
      >
        <Text style={s.secondaryText}>
          {busy ? "正在估算下载…" : "下载供离线阅读"}
        </Text>
      </Pressable>
    </View>
  );
}
