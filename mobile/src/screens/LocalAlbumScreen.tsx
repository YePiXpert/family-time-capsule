import { useCallback, useState } from "react";
import { FlatList, Image, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Text, TextInput } from "../components/typography";
import { Button } from "../components/ui";
import { useConfirmSheet } from "../components/GlassSheet";
import { useAppActions, useAppData } from "../state/AppContext";
import { useSharedStyles } from "../theme";
import { draftReadingScope } from "../drafts/reading";
import {
  getLocalAlbum,
  saveLocalAlbum,
  type LocalAlbum,
} from "../collections/local";
import { authorizeAlbumSync } from "../collections/sync";
import {
  resolveMaterials,
  type MaterialPresentation,
} from "../worksession/materials";
import { createWorkSession } from "../worksession/store";
import type { RootStackParamList } from "../navigation/types";

export function LocalAlbumScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "LocalAlbum">) {
  const s = useSharedStyles(),
    confirm = useConfirmSheet();
  const { credentials, userId, viewer, family } = useAppData();
  const { runSync } = useAppActions();
  const scope = draftReadingScope(credentials, userId, viewer?.id, family?.id),
    valid =
      scope !== null &&
      (route.params.scope === "local" || scope === route.params.scope);
  const [album, setAlbum] = useState<LocalAlbum | null>(null),
    [rows, setRows] = useState<MaterialPresentation[]>([]),
    [title, setTitle] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [organizing, setOrganizing] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      setAlbum(null);
      setRows([]);
      if (valid)
        void getLocalAlbum(route.params.scope, route.params.id)
          .then(async (row) => {
            if (!live) return;
            if (!row) throw new Error("相册暂不可读。");
            setAlbum(row);
            setTitle(row.title);
            if (row.remoteId && !row.pending) {
              navigation.replace("CollectionDetail", { id: row.remoteId });
              return;
            }
            try {
              const next = await resolveMaterials(
                row.items.map((i) => i.ref),
                scope ?? "local",
                credentials,
                "personal",
              );
              if (live) setRows(next);
            } catch (e) {
              if (live) setError((e as Error).message);
            }
          })
          .catch((e) => {
            if (live) setError(e.message);
          });
      return () => {
        live = false;
      };
    }, [
      route.params.scope,
      route.params.id,
      valid,
      scope,
      credentials,
      navigation,
    ]),
  );
  async function change(transform: (a: LocalAlbum) => LocalAlbum) {
    if (!album || busy) return;
    setBusy(true);
    try {
      const next = {
        ...transform(album),
        revision: album.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await saveLocalAlbum(next, album.revision);
      setAlbum(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (!album) return;
    try {
      const session = await createWorkSession(album.scope, {
        mode: "append",
        kind: "localAlbum",
        id: album.id,
      });
      navigation.navigate("MaterialPicker", {
        scope: session.scope,
        sessionId: session.id,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function share() {
    if (!album || !scope || scope === "local" || !credentials) return;
    if (
      !(await confirm({
        title: album.remoteId ? "上传待加入的记录" : "同步到这个家庭",
        message: `相册名称“${album.title}”将对「${family?.name ?? "已连接的家庭"}」（${credentials.serverUrl}）可见。将上传 ${album.items.filter((i) => i.ref.kind === "localDraft").length} 条本机记录及原件：${
          rows
            .filter((r) => r.ref.kind === "localDraft" && r.available)
            .slice(0, 3)
            .map((r) => r.title)
            .join("、") || "没有尚未上传的本机记录"
        }。记录自身的读者范围保持原样。`,
        confirmLabel: "同意上传并同步",
        cancelLabel: "继续仅本机",
      }))
    )
      return;
    setBusy(true);
    try {
      const next = await authorizeAlbumSync(album, scope);
      setAlbum(next);
      if (next.scope !== route.params.scope)
        navigation.setParams({ scope: next.scope });
      await runSync();
      const updated = await getLocalAlbum(next.scope, next.id);
      if (updated?.remoteId && !updated.pending)
        navigation.replace("CollectionDetail", { id: updated.remoteId });
      else if (updated) setAlbum(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!valid)
    return (
      <View style={s.empty}>
        <Text style={s.body}>请连接原来的家庭后查看相册。</Text>
      </View>
    );
  if (!album)
    return (
      <View style={s.empty}>
        <Text style={s.body}>{error || "正在打开…"}</Text>
      </View>
    );
  const canEdit = !album.remoteId && !album.pending;
  const editable = canEdit && organizing;
  const visibleRows = rows.filter(
    (r) => r.ref.scope === "local" || r.ref.scope === scope,
  );
  const cover =
    visibleRows.find(
      (r) =>
        album.items.find((i) => i.id === album.coverItemId)?.ref.id ===
        r.ref.id,
    ) ?? visibleRows.find((r) => r.uri);
  return (
    <FlatList
      testID="local-album-reading"
      data={album.items}
      keyExtractor={(item) => item.id}
      initialNumToRender={8}
      windowSize={5}
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 16, paddingBottom: 16 }}>
          {cover?.uri ? (
            <Image
              source={{
                uri: cover.uri,
                ...(cover.remote && credentials
                  ? {
                      headers: { Authorization: `Bearer ${credentials.token}` },
                    }
                  : {}),
              }}
              resizeMode="contain"
              style={{ width: "100%", height: 280, borderRadius: 12 }}
            />
          ) : null}
          <Text style={s.title}>{album.title}</Text>
          <Text style={s.body}>
            {album.remoteId
              ? "待加入内容已保存在本机"
              : album.pending
                ? "已保存在本机 · 等待同步"
                : "仅本机 · 随时可以离线编辑"}
          </Text>
          {canEdit ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button
                title="添加记录"
                variant="primary"
                full={false}
                onPress={() => void add()}
                disabled={busy}
              />
              <Button
                title={organizing ? "完成整理" : "整理"}
                full={false}
                onPress={() => setOrganizing((v) => !v)}
              />
            </View>
          ) : null}
          {editable ? (
            <>
              <TextInput
                accessibilityLabel="相册名称"
                value={title}
                maxLength={200}
                onChangeText={setTitle}
                onEndEditing={() => {
                  if (title.trim() && title !== album.title)
                    void change((a) => ({ ...a, title: title.trim() }));
                }}
                style={s.input}
              />
            </>
          ) : null}
        </View>
      }
      renderItem={({ item, index }) => {
        const row = visibleRows.find(
          (r) =>
            r.ref.kind === item.ref.kind &&
            r.ref.scope === item.ref.scope &&
            r.ref.id === item.ref.id,
        );
        return (
          <View key={item.id} style={s.card}>
            {row?.uri ? (
              <Image
                source={{
                  uri: row.uri,
                  ...(row.remote && credentials
                    ? {
                        headers: {
                          Authorization: `Bearer ${credentials.token}`,
                        },
                      }
                    : {}),
                }}
                resizeMode="contain"
                style={{ width: "100%", height: 210 }}
              />
            ) : null}
            <Button
              title={row?.title ?? "记录暂不可读"}
              variant="ghost"
              disabled={!row?.available}
              onPress={() =>
                row?.sourceMemoryId
                  ? navigation.navigate("Memory", { id: row.sourceMemoryId })
                  : item.ref.kind === "localDraft"
                    ? navigation.navigate("SavedMemory", {
                        draftId: item.ref.id,
                        scope: item.ref.scope,
                      })
                    : navigation.navigate("Memory", { id: item.ref.id })
              }
            />
            {row?.text ? <Text style={s.body}>{row.text}</Text> : null}
            {editable ? (
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button
                  title="设为封面"
                  full={false}
                  disabled={!row?.uri || busy}
                  onPress={() =>
                    void change((a) => ({ ...a, coverItemId: item.id }))
                  }
                />
                <Button
                  title="上移"
                  full={false}
                  disabled={index === 0 || busy}
                  onPress={() =>
                    void change((a) => {
                      const items = [...a.items];
                      [items[index - 1], items[index]] = [
                        items[index]!,
                        items[index - 1]!,
                      ];
                      return { ...a, items };
                    })
                  }
                />
                <Button
                  title="移除"
                  full={false}
                  disabled={busy}
                  onPress={() =>
                    void change((a) => ({
                      ...a,
                      items: a.items.filter((i) => i.id !== item.id),
                      coverItemId:
                        a.coverItemId === item.id ? null : a.coverItemId,
                    }))
                  }
                />
              </View>
            ) : null}
          </View>
        );
      }}
      ListFooterComponent={
        <View style={{ gap: 16, paddingTop: 16 }}>
          {album.syncRejected && !album.remoteId ? (
            <Button
              title="继续本机整理"
              onPress={() => {
                void change((a) => ({
                  ...a,
                  pending: null,
                  consent: null,
                  syncRejected: false,
                  error: "",
                }));
                setOrganizing(true);
              }}
            />
          ) : null}
          {error || album.error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error || album.error}
            </Text>
          ) : null}
          {credentials && scope !== "local" ? (
            <Button
              title={
                busy
                  ? "正在处理…"
                  : album.pending
                    ? "同步待加入内容"
                    : "同步给家庭"
              }
              disabled={busy}
              onPress={() => void share()}
            />
          ) : (
            <Text style={s.body}>连接家庭后，可选择是否同步这本相册。</Text>
          )}
        </View>
      }
    />
  );
}
