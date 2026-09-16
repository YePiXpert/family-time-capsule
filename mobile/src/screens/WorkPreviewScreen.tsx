import { useEffect, useState } from "react";
import { Image, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Text, TextInput } from "../components/typography";
import { Button, Chip } from "../components/ui";
import { useSharedStyles } from "../theme";
import { useAppData } from "../state/AppContext";
import type { RootStackParamList } from "../navigation/types";
import { useWorkSession } from "../worksession/useSession";
import {
  resolveMaterials,
  type MaterialPresentation,
} from "../worksession/materials";
import { commitWorkSession } from "../worksession/commit";
import { materialKey } from "../collections/local";
export function WorkPreviewScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "WorkPreview">) {
  const s = useSharedStyles(),
    { credentials } = useAppData();
  const { session, update, error, setError, valid, flush } = useWorkSession(
    route.params.scope,
    route.params.sessionId,
  );
  const [resolved, setResolved] = useState<{
      key: string;
      rows: MaterialPresentation[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const selected = session?.selected,
    audience = session?.audience,
    book = session?.target.kind === "book";
  const queryKey = JSON.stringify([
    route.params.scope,
    credentials?.token,
    selected,
    audience,
    book,
    retry,
  ]);
  const rows = resolved?.key === queryKey ? resolved.rows : [],
    verified = resolved?.key === queryKey;
  useEffect(() => {
    let live = true;
    if (selected)
      void resolveMaterials(
        selected,
        route.params.scope,
        credentials,
        book ? (audience ?? "personal") : "personal",
      )
        .then((next) => {
          if (live) {
            setResolved({ key: queryKey, rows: next });
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError((e as Error).message);
        });
    return () => {
      live = false;
    };
  }, [
    selected,
    audience,
    book,
    credentials,
    route.params.scope,
    retry,
    setError,
    queryKey,
  ]);
  async function create() {
    if (!session || busy || !verified || rows.some((r) => !r.available)) return;
    setBusy(true);
    try {
      await flush();
      const result = await commitWorkSession(session, credentials);
      navigation.popTo("MainTabs", { screen: "Works" });
      if (result.kind === "localAlbum")
        navigation.navigate("LocalAlbum", {
          scope: session.scope,
          id: result.id,
        });
      else if (result.kind === "book")
        navigation.navigate("BookDetail", { id: result.id });
      else navigation.navigate("CollectionDetail", { id: result.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!valid)
    return (
      <View style={s.empty}>
        <Text style={s.body}>账号或家庭已变化，请重新选择。</Text>
      </View>
    );
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.title}>{book ? "成长册预览" : "相册预览"}</Text>
      <Text style={s.body}>
        {book
          ? "先看看选中的内容，再完成成册。"
          : "先保存在本机，分享给家庭时再确认同步。"}
      </Text>
      <TextInput
        accessibilityLabel="作品名称"
        placeholder={book ? "为这本成长册起个名字" : "相册名称"}
        style={s.input}
        value={session?.title ?? ""}
        maxLength={200}
        onChangeText={(title) => void update((r) => ({ ...r, title }))}
      />
      {rows.map((row, index) => (
        <View key={materialKey(row.ref)} style={s.card}>
          {row.uri ? (
            <Image
              source={{
                uri: row.uri,
                ...(row.remote && credentials
                  ? {
                      headers: { Authorization: `Bearer ${credentials.token}` },
                    }
                  : {}),
              }}
              resizeMode="contain"
              style={{ width: "100%", height: 210, borderRadius: 8 }}
            />
          ) : null}
          <Text style={s.cardTitle}>{row.title}</Text>
          {row.date ? <Text style={s.body}>{row.date}</Text> : null}
          {!row.available ? (
            <Text style={s.error}>
              {book && audience === "family"
                ? "这条内容不适合全家可见；可改为仅自己或移除。"
                : "内容暂不可读，请重试或移除。"}
            </Text>
          ) : null}
          {!book ? (
            <Button
              title={
                session?.coverRefKey === materialKey(row.ref)
                  ? "当前封面"
                  : "设为封面"
              }
              disabled={!row.uri}
              onPress={() =>
                void update((r) => ({
                  ...r,
                  coverRefKey: materialKey(row.ref),
                }))
              }
            />
          ) : null}
          <Button
            title="移除"
            accessibilityLabel={`移除第 ${index + 1} 条`}
            variant="ghost"
            full={false}
            onPress={() =>
              void update((r) => ({
                ...r,
                selected: r.selected.filter(
                  (ref) => materialKey(ref) !== materialKey(row.ref),
                ),
              }))
            }
          />
        </View>
      ))}
      <Button
        title="继续添加内容"
        onPress={() => navigation.navigate("MaterialPicker", route.params)}
      />
      {book ? (
        <View style={{ gap: 12 }}>
          <Text style={s.label}>谁可以阅读</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Chip
              label="仅自己"
              selected={audience === "personal"}
              onPress={() =>
                void update((r) => ({ ...r, audience: "personal" }))
              }
            />
            <Chip
              label="全家可见"
              selected={audience === "family"}
              onPress={() => void update((r) => ({ ...r, audience: "family" }))}
            />
          </View>
          <Text style={s.label}>样式</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Chip
              label="成长手记"
              selected={session?.template === "growth"}
              onPress={() => void update((r) => ({ ...r, template: "growth" }))}
            />
            <Chip
              label="照片集"
              selected={session?.template === "photos"}
              onPress={() => void update((r) => ({ ...r, template: "photos" }))}
            />
          </View>
        </View>
      ) : null}
      {error || rows.some((r) => !r.available) ? (
        <>
          {error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null}
          <Button title="重新核对内容" onPress={() => setRetry((v) => v + 1)} />
        </>
      ) : null}
      <Button
        testID="preview-save"
        variant="primary"
        title={busy ? "正在保存…" : book ? "生成成长册" : "保存本机相册"}
        disabled={
          busy || !verified || !rows.length || rows.some((r) => !r.available)
        }
        onPress={() => void create()}
      />
    </ScrollView>
  );
}
