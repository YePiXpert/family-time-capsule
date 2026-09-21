import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useStore } from "../local/context";
import type { Props } from "../local/navigation";
import {
  Button,
  ErrorText,
  Field,
  Page,
  Text,
  messageOf,
  useStyles,
} from "../local/ui";
import { keyFromMnemonic, mnemonicOf } from "./crypto";
import { joinFamily } from "./family";
import { loadKey } from "./state";
import { SyncError, createTransport } from "./transport";
/**
 * 恢复码页。show：把这台手机的 12 个词摆出来抄；join：输入 12 个词，加入家人一起写。
 * 恢复码就是钥匙，所以这一页只在「我的 → 备份与恢复」里，不进普通记录流程。
 */
export function RecoveryCode({ route, navigation }: Props<"RecoveryCode">) {
  const store = useStore(),
    s = useStyles();
  const [words, setWords] = useState<string[] | null>(null),
    [input, setInput] = useState(""),
    [progress, setProgress] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const show = route.params.mode === "show";
  useEffect(() => {
    if (!show) return;
    loadKey()
      .then((key) => setWords(key ? mnemonicOf(key).split(" ") : []))
      .catch((e: unknown) => {
        // 钥匙串读不出来：说清楚，别停在「正在读取…」。
        setError(messageOf(e));
        setWords([]);
      });
  }, [show]);
  // 离开这一页就停止还在跑的同步。
  useEffect(() => {
    const active = controller;
    return () => active.current?.abort();
  }, []);
  const join = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setMessage("");
    setProgress("正在连接远端…");
    try {
      const key = keyFromMnemonic(input);
      await joinFamily(store, key, {
        transport: createTransport(),
        onProgress: setProgress,
        signal: abort.signal,
      });
      setMessage("已加入，同步完成。");
    } catch (e) {
      if (e instanceof SyncError && e.code === "CANCELED")
        setMessage("已停止。");
      else setError(messageOf(e));
    } finally {
      controller.current = null;
      setProgress("");
    }
  };
  const running = !!progress;
  return (
    <Page title="恢复码" testID="recovery-code">
      {show ? (
        <>
          <Text style={s.muted}>
            这 12
            个词就是打开远端备份的唯一钥匙。请抄在纸上，放在家里安全的地方；不要截图，不要发到聊天里。
          </Text>
          {words === null ? (
            <Text>正在读取…</Text>
          ) : words.length === 0 ? (
            <ErrorText message={error || "这台手机上还没有远端备份的钥匙。"} />
          ) : (
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12 }}
              accessibilityLabel={`恢复码：${words.join("，")}`}
            >
              {words.map((word, i) => (
                <View
                  key={i}
                  style={{ width: "33.33%", flexDirection: "row", gap: 6 }}
                >
                  <Text style={s.muted}>{String(i + 1).padStart(2, " ")}</Text>
                  <Text style={{ fontWeight: "600" }}>{word}</Text>
                </View>
              ))}
            </View>
          )}
          <Button
            title="我已抄在纸上"
            primary
            testID="recovery-done"
            onPress={() => navigation.goBack()}
          />
        </>
      ) : (
        <>
          <Text style={s.muted}>
            输入那台手机上抄下的 12
            个英文词，就能加入家人一起写。本机已有的内容会与家人的内容合在一起。
          </Text>
          <Field
            label="恢复码"
            placeholder="12 个英文词，用空格隔开"
            value={input}
            onChangeText={setInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            editable={!running}
            testID="recovery-input"
          />
          <ErrorText message={error} />
          <Text accessibilityLiveRegion="polite">{progress || message}</Text>
          <View style={s.row}>
            <Button
              title={progress ? "正在同步…" : "加入并同步"}
              primary
              testID="recovery-start"
              disabled={running || !input.trim()}
              onPress={() => {
                void join();
              }}
            />
            {running && (
              <Button
                title="停止"
                kind="text"
                compact
                onPress={() => controller.current?.abort()}
              />
            )}
          </View>
        </>
      )}
    </Page>
  );
}
