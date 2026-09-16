import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";
import { Text } from "../components/typography";
import { Button } from "../components/ui";
import { useAppData } from "../state/AppContext";
import { draftReadingScope } from "../drafts/reading";
import { createWorkSession } from "../worksession/store";
import type { AppNavigation } from "../navigation/types";
import { useSharedStyles } from "../theme";
/** Compatibility entry for old shelf routes; selection lives on one stable screen. */
export function WorkCreator({
  kind,
  initialMemoryIds = [],
  onCancel,
}: {
  kind: "album" | "book";
  initialMemoryIds?: readonly string[];
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const s = useSharedStyles(),
    navigation = useNavigation<AppNavigation>();
  const { credentials, userId, viewer, family } = useAppData();
  const [error, setError] = useState("");
  async function start() {
    try {
      const scope = draftReadingScope(
        credentials,
        userId,
        viewer?.id,
        family?.id,
      );
      if (!scope) throw new Error("请等待当前家庭验证完成。");
      if (kind === "book" && scope === "local")
        throw new Error("连接家庭后可以制作成长册，本机相册现在就能创建。");
      const row = await createWorkSession(
        scope,
        { mode: "create", kind },
        initialMemoryIds.map((id) => ({ kind: "memory", scope, id })),
      );
      navigation.navigate("MaterialPicker", { scope, sessionId: row.id });
      onCancel();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <View style={s.card}>
      <Button
        title={kind === "book" ? "选择成长册内容" : "选择相册内容"}
        variant="primary"
        onPress={() => void start()}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Button title="取消" variant="ghost" onPress={onCancel} />
    </View>
  );
}
