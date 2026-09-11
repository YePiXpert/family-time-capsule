import { Text, TextInput } from "../components/typography";
import { WorkCreator } from "./WorkCreator";
import { Disclosure } from "../components/Disclosure";
import { ReadingDownloadButton } from "../reading/DownloadButton";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { randomUUID } from "expo-crypto";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import {
  fetchCollection,
  fetchCollections,
  mutateCollection,
} from "../api/client";
import type { CollectionDetail, CollectionPage } from "../collections/types";
import type { RootStackParamList } from "../navigation/types";
import { useApp } from "../state/AppContext";
import { useConfirmSheet } from "../components/GlassSheet";
import { useSharedStyles } from "../theme";
function Button({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const s = useSharedStyles();
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
export function CollectionsScreen({
  navigation,
  route,
}: { navigation: Pick<NativeStackScreenProps<RootStackParamList, "Collections">["navigation"], "navigate">; route: NativeStackScreenProps<RootStackParamList, "Collections">["route"] }) {
  const s = useSharedStyles();
  const { credentials } = useApp();
  const [page, setPage] = useState<CollectionPage | null>(null),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [deleted, setDeleted] = useState(false),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async (cursor = "") => {
      if (!credentials) {
        setError("连接家庭服务器后可以整理相册。");
        return;
      }
      try {
        const data = await fetchCollections(credentials, deleted, cursor);
        setPage((p) =>
          cursor && p
            ? { ...data, entries: [...p.entries, ...data.entries] }
            : data,
        );
        setError("");
      } catch (e) {
        setPage(null);
        setError((e as Error).message);
      }
    },
    [credentials, deleted],
  );
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  async function choose(id: string, revision: number) {
    if (!credentials) return;
    if (!route.params?.eventIds?.length || !page?.canWrite || deleted) {
      navigation.navigate("CollectionDetail", { id });
      return;
    }
    setBusy(true);
    try {
      await mutateCollection(credentials, id, {
        operation: "add",
        revision,
        eventIds: route.params.eventIds,
      });
      navigation.navigate("CollectionDetail", { id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >

      <Text style={s.intro}>
        {route.params?.eventIds?.length
          ? `将所选 ${route.params.eventIds.length} 条记忆加入相册。只建立关系，原件不会复制。`
          : "把一段真实的家庭经历整理在一起。"}
      </Text>
      <Disclosure title="管理"><Button
        title={deleted ? "返回相册" : "相册回收站"}
        onPress={() => setDeleted(!deleted)}
      /></Disclosure>
      {error ? (
        <>
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
          <Button title="重试" onPress={() => void load()} />
        </>
      ) : null}
      {page?.canWrite && !deleted && !creating ? <Button title="新建相册" onPress={() => setCreating(true)} /> : null}
      {creating ? <WorkCreator kind="album" onCancel={() => setCreating(false)} onCreated={id => { setCreating(false); navigation.navigate("CollectionDetail", { id }); }} /> : null}
      {page?.entries.map((c) => (
        <Pressable
          key={c.id}
          disabled={busy}
          onPress={() => void choose(c.id, c.revision)}
          style={s.card}
        >
          {c.coverAssetId && credentials ? (
            <Image
              source={{
                uri: `${credentials.serverUrl}/api/media/${encodeURIComponent(c.coverAssetId)}`,
                headers: { Authorization: `Bearer ${credentials.token}` },
              }}
              accessibilityLabel="相册封面"
              style={{ height: 170, width: "100%", borderRadius: 12 }}
            />
          ) : null}
          <Text style={s.cardTitle}>{c.title}</Text>
          <Text style={s.body}>
            {c.count} 份可见内容 · {c.kind === "album" ? "主题相册" : "章节"}
          </Text>
          <Text style={s.body}>{c.description}</Text>
        </Pressable>
      ))}
      {page && !page.entries.length ? (
        <Text style={s.body}>
          这里还没有相册，可以先取个名字，再从时间轴多选记忆。
        </Text>
      ) : null}
      {page?.nextCursor ? (
        <Button title="更多相册" onPress={() => void load(page.nextCursor!)} />
      ) : null}
    </ScrollView>
  );
}
export function CollectionDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "CollectionDetail">) {
  const s = useSharedStyles();
  const { credentials } = useApp();
  const confirm = useConfirmSheet();
  const [reading, setReading] = useState(true);
  const [doc, setDoc] = useState<CollectionDetail | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const load = useCallback(async () => {
    if (!credentials) {
      setError("连接服务器后可打开相册。");
      return;
    }
    try {
      const next = await fetchCollection(credentials, route.params.id);
      setDoc(next);
      dirty.current = false;
      setError("");
      setStatus("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [credentials, route.params.id]);
  useFocusEffect(
    useCallback(() => {
      if (!dirty.current) void load();
    }, [load]),
  );
  function update(next: CollectionDetail) {
    setDoc(next);
    dirty.current = true;
    setStatus("有未保存修改");
  }
  async function save(operation = "save") {
    if (!credentials || !doc || busy) return false;
    setBusy(true);
    try {
      const next = await mutateCollection(credentials, doc.id, {
        operation,
        revision: doc.revision,
        edit: doc,
      });
      setDoc(next);
      dirty.current = false;
      setStatus("已保存；源记忆和原件不受影响。");
      setError("");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, delta: number) {
    if (!doc) return;
    const items = [...doc.items],
      next = index + delta;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next]!, items[index]!];
    update({ ...doc, items, sortMode: "manual" });
  }
  if (!doc)
    return (
      <View style={s.empty}>
        <Text style={s.error}>{error || "正在打开相册…"}</Text>
        <Button title="重试" onPress={() => void load()} />
      </View>
    );
  const editable = doc.canWrite && !doc.deletedAt && !reading;
  const items =
    doc.sortMode === "time"
      ? [...doc.items].sort(
          (a, b) =>
            (a.source?.occurredAt ?? "9999").localeCompare(
              b.source?.occurredAt ?? "9999",
            ) || a.id.localeCompare(b.id),
        )
      : doc.items;
  const displayItems = editable
    ? items
    : [...items].sort(
        (a, b) =>
          doc.sections.findIndex((s) => s.id === a.sectionId) -
          doc.sections.findIndex((s) => s.id === b.sectionId),
      );
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      {!doc.deletedAt ? <ReadingDownloadButton kind="collection" id={doc.id} prepare={async () => dirty.current ? await save() : true} /> : null}
      <Text style={s.title}>{doc.title}</Text>
      {doc.canWrite && !doc.deletedAt ? (
        <Button
          title={reading ? "继续编辑" : "阅读相册"}
          onPress={() => setReading(!reading)}
        />
      ) : null}
      <Text style={s.body}>
        版本 {doc.revision}
        {doc.deletedAt ? " · 在相册回收站中" : ""}
      </Text>
      {status ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {status}
        </Text>
      ) : null}
      {error ? (
        <>
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
          <Button
            title="重新读取服务器版本"
            onPress={() =>
              void confirm({
                title: "重新读取",
                message: "未保存输入将被替换，请先复制需要保留的文字。",
                confirmLabel: "重新读取",
                cancelLabel: "保留输入",
              }).then(confirmed => { if (confirmed) void load(); })
            }
          />
        </>
      ) : null}
      {editable ? (
        <>
          <Text style={s.label}>名称</Text>
          <TextInput
            style={s.input}
            accessibilityLabel="名称"
            value={doc.title}
            maxLength={200}
            onChangeText={(title) => update({ ...doc, title })}
          />
          <Button title={doc.kind === "album" ? "形式：相册，改为章节" : "形式：章节，改为相册"} onPress={() => update({ ...doc, kind: doc.kind === "album" ? "chapter" : "album" })} />
          <Text style={s.label}>简介</Text>
          <TextInput
            style={[s.input, { minHeight: 96, textAlignVertical: "top" }]}
            accessibilityLabel="简介"
            value={doc.description}
            maxLength={5000}
            multiline
            onChangeText={(description) => update({ ...doc, description })}
          />
          <Text style={s.label}>开始日期（YYYY-MM-DD，可选）</Text>
          <TextInput
            style={s.input}
            value={doc.startDate || ""}
            maxLength={10}
            onChangeText={(v) => update({ ...doc, startDate: v || null })}
          />
          <Text style={s.label}>结束日期（YYYY-MM-DD，可选）</Text>
          <TextInput
            style={s.input}
            value={doc.endDate || ""}
            maxLength={10}
            onChangeText={(v) => update({ ...doc, endDate: v || null })}
          />
          <Button
            title={doc.sortMode === "manual" ? "顺序：手动" : "顺序：发生时间"}
            onPress={() =>
              update({
                ...doc,
                sortMode: doc.sortMode === "manual" ? "time" : "manual",
              })
            }
          />
          <Button
            title="清除封面"
            disabled={!doc.coverAssetId}
            onPress={() => update({ ...doc, coverAssetId: null })}
          />
          <Button
            title="保存相册"
            disabled={busy}
            onPress={() => void save()}
          />
          <Button
            title="去时间轴挑选记忆"
            onPress={() =>
              navigation.navigate("MainTabs", { screen: "Timeline" })
            }
          />
        </>
      ) : (
        <Text style={s.body}>{doc.description}</Text>
      )}
      {doc.kind === "chapter" ? (
        <View style={{ gap: 10 }}>
          <Text style={s.cardTitle}>章节小节</Text>
          {doc.sections.map((section, index) => (
            <View key={section.id} style={s.card}>
              {editable ? (
                <>
                  <TextInput
                    accessibilityLabel={`小节 ${index + 1} 名称`}
                    style={s.input}
                    value={section.title}
                    maxLength={200}
                    onChangeText={(title) =>
                      update({
                        ...doc,
                        sections: doc.sections.map((s) =>
                          s.id === section.id ? { ...s, title } : s,
                        ),
                      })
                    }
                  />
                  <Button
                    title="移除小节"
                    onPress={() =>
                      update({
                        ...doc,
                        sections: doc.sections.filter(
                          (s) => s.id !== section.id,
                        ),
                        items: doc.items.map((item) =>
                          item.sectionId === section.id
                            ? { ...item, sectionId: null }
                            : item,
                        ),
                      })
                    }
                  />
                  <Button
                    title="小节上移"
                    disabled={index === 0}
                    onPress={() => {
                      const sections = [...doc.sections];
                      [sections[index - 1], sections[index]] = [
                        sections[index]!,
                        sections[index - 1]!,
                      ];
                      update({ ...doc, sections });
                    }}
                  />
                  <Button
                    title="小节下移"
                    disabled={index === doc.sections.length - 1}
                    onPress={() => {
                      const sections = [...doc.sections];
                      [sections[index + 1], sections[index]] = [
                        sections[index]!,
                        sections[index + 1]!,
                      ];
                      update({ ...doc, sections });
                    }}
                  />
                </>
              ) : (
                <Text style={s.body}>{section.title}</Text>
              )}
            </View>
          ))}
          {editable ? (
            <Button
              title="添加小节"
              disabled={doc.sections.length >= 20}
              onPress={() =>
                update({
                  ...doc,
                  sections: [
                    ...doc.sections,
                    { id: randomUUID(), title: "新小节" },
                  ],
                })
              }
            />
          ) : null}
        </View>
      ) : null}
      {displayItems.map((item, displayIndex) => (
        <View style={s.card} key={item.id}>
          {!editable &&
          item.sectionId &&
          (displayIndex === 0 ||
            displayItems[displayIndex - 1]?.sectionId !== item.sectionId) ? (
            <Text style={s.cardTitle}>
              {doc.sections.find((s) => s.id === item.sectionId)?.title}
            </Text>
          ) : null}
          {item.source ? (
            <>
              <Pressable
                onPress={() =>
                  item.assetId ? navigation.navigate("AssetDetail", { id: item.assetId }) : navigation.navigate("Memory", { id: item.memoryEventId! })
                }
              >
                <Text style={s.cardTitle}>{item.source.title}</Text>
                <Text style={s.body}>
                  {item.source.occurredAt ? new Intl.DateTimeFormat("zh-CN", {
                    dateStyle: "long",
                    timeZone: doc.timezone,
                  }).format(new Date(item.source.occurredAt)) : "时间待补"}
                </Text>
              </Pressable>
              {item.source.previewAssetId && credentials ? (
                <Image
                  accessibilityLabel={item.caption || item.source.title}
                  source={{
                    uri: `${credentials.serverUrl}/api/media/${encodeURIComponent(item.source.previewAssetId)}`,
                    headers: { Authorization: `Bearer ${credentials.token}` },
                  }}
                  style={{ width: "100%", height: 230, resizeMode: "contain" }}
                />
              ) : null}
            </>
          ) : (
            <Text style={s.body}>来源已删除或当前不可见</Text>
          )}
          {editable ? (
            <>
              <Text style={s.label}>图文说明</Text>
              <TextInput
                style={[s.input, { minHeight: 96, textAlignVertical: "top" }]}
                accessibilityLabel="图文说明"
                value={item.caption}
                multiline
                maxLength={2000}
                onChangeText={(caption) =>
                  update({
                    ...doc,
                    items: doc.items.map((i) =>
                      i.id === item.id ? { ...i, caption } : i,
                    ),
                  })
                }
              />
              <Button
                title="上移"
                disabled={doc.items[0]?.id === item.id}
                onPress={() =>
                  move(
                    doc.items.findIndex((i) => i.id === item.id),
                    -1,
                  )
                }
              />
              <Button
                title="下移"
                disabled={doc.items.at(-1)?.id === item.id}
                onPress={() =>
                  move(
                    doc.items.findIndex((i) => i.id === item.id),
                    1,
                  )
                }
              />
              {item.source?.coverAssetId ? (
                <Button
                  title={
                    doc.coverAssetId === item.source.coverAssetId
                      ? "当前封面"
                      : "用作封面"
                  }
                  onPress={() =>
                    update({ ...doc, coverAssetId: item.source!.coverAssetId })
                  }
                />
              ) : null}
              {doc.sections.length ? (
                <Button
                  title={`所属小节：${doc.sections.find((s) => s.id === item.sectionId)?.title || "未分小节"}（点按切换）`}
                  onPress={() => {
                    const index = doc.sections.findIndex(
                        (s) => s.id === item.sectionId,
                      ),
                      sectionId = doc.sections[index + 1]?.id ?? null;
                    update({
                      ...doc,
                      items: doc.items.map((i) =>
                        i.id === item.id ? { ...i, sectionId } : i,
                      ),
                    });
                  }}
                />
              ) : null}
              <Button
                title="移出相册"
                onPress={() =>
                  update({
                    ...doc,
                    items: doc.items.filter((i) => i.id !== item.id),
                  })
                }
              />
            </>
          ) : (
            <Text style={s.body}>{item.caption}</Text>
          )}
        </View>
      ))}
      {busy ? <ActivityIndicator color={s.colors.coral} /> : null}
      {editable ? (
        <Button
          title="保存排序与说明"
          disabled={busy}
          onPress={() => void save()}
        />
      ) : null}
      {doc.canWrite ? (
        <Button
          title={doc.deletedAt ? "恢复相册" : "删除相册"}
          disabled={busy}
          onPress={() =>
            doc.deletedAt
              ? void save("restore")
              : void confirm({
                  title: "删除相册",
                  message: "移入相册回收站后可以恢复；源记忆、讲述和原件不受影响。",
                  confirmLabel: "移入回收站",
                }).then(confirmed => { if (confirmed) void save("delete"); })
          }
        />
      ) : null}
    </ScrollView>
  );
}
