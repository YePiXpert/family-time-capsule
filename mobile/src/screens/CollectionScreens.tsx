import { Text, TextInput } from "../components/typography";
import { draftReadingScope } from "../drafts/reading";
import { listLocalAlbums,type LocalAlbum } from "../collections/local";
import { createWorkSession } from "../worksession/store";
import { commitWorkSession } from "../worksession/commit";
import { invalidateReadingCredentials,nativeReadingTransport,readingDownloads,resolveReadingScope } from "../reading/native";
import { ReadingDownloadButton } from "../reading/DownloadButton";
import { useReadingShelf } from "../reading/useReadingShelf";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { randomUUID } from "expo-crypto";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import {
  ApiError,
  fetchCollection,
  fetchCollections,
  mutateCollection,
} from "../api/client";
import type { CollectionDetail } from "../collections/types";
import type { RootStackParamList } from "../navigation/types";
import { useAppActions,useAppData } from "../state/AppContext";
import { GlassSheet, useConfirmSheet } from "../components/GlassSheet";
import { Button as ActionButton, IconButton } from "../components/ui";
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
type CollectionsProps = { navigation: Pick<NativeStackScreenProps<RootStackParamList, "Collections">["navigation"], "navigate">; route: NativeStackScreenProps<RootStackParamList, "Collections">["route"] };
export function CollectionsScreen({navigation,route}: CollectionsProps) {
  const s=useSharedStyles();
  const {credentials,userId,viewer,family,online}=useAppData();
  const {runSync}=useAppActions();
  const confirm=useConfirmSheet();
  const scope=draftReadingScope(credentials,userId,viewer?.id,family?.id);
  const {page,downloads,offline,error:loadError,loading,load}=useReadingShelf("collection",false,fetchCollections);
  const [locals,setLocals]=useState<LocalAlbum[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const valid=!!scope&&(!route.params?.scope||route.params.scope===scope||route.params.scope==="local");
  const refs=route.params?.refs??(route.params?.eventIds??[]).map(id=>({kind:"memory" as const,scope:scope??"local",id}));
  useFocusEffect(useCallback(()=>{let live=true;setLocals([]);if(scope)void Promise.all([listLocalAlbums("local"),scope!=="local"?listLocalAlbums(scope):Promise.resolve([])]).then(rows=>{if(live)setLocals(rows.flat().filter(a=>!a.remoteId));});return()=>{live=false;};},[scope,setLocals]));
  async function choose(kind:"localAlbum"|"collection",id:string,targetScope:string,revision?:number){
    if(!valid||busy)return;setBusy(true);try{
      if(!refs.length){if(kind==="localAlbum")navigation.navigate("LocalAlbum",{id,scope:targetScope});else {const download=offline?downloads.find(d=>d.id===id):null;if(download)navigation.navigate("OfflineReading",{key:download.key});else navigation.navigate("CollectionDetail",{id});}return;}
      const session=await createWorkSession(targetScope,{mode:"append",kind,id,revision},refs);
      const authorizeSources=kind==="collection"&&refs.some(r=>r.kind==="localDraft");
      if(authorizeSources&&!await confirm({title:"上传这些记录并加入相册",message:`将 ${refs.filter(r=>r.kind==="localDraft").length} 条本机记录及原件上传到「${family?.name??"已连接的家庭"}」（${credentials?.serverUrl??""}），原记录的读者范围保持不变。`,confirmLabel:"同意上传并加入",cancelLabel:"保留选择"}))return;
      await commitWorkSession(session,credentials,{authorizeSources});
      if(kind==="collection"&&online!==false)void runSync();
      if(kind==="localAlbum")navigation.navigate("LocalAlbum",{id,scope:targetScope});else navigation.navigate("CollectionDetail",{id});
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function create(){if(!scope||!valid)return;try{const session=await createWorkSession(scope,{mode:"create",kind:"album"},refs);if(refs.length){const result=await commitWorkSession(session,credentials);navigation.navigate("LocalAlbum",{id:result.id,scope});}else navigation.navigate("MaterialPicker",{scope,sessionId:session.id});}catch(e){setError((e as Error).message);}}
  return <ScrollView style={s.screen} contentContainerStyle={s.content}><Text style={s.title}>加入相册</Text><Text style={s.body}>选择想放入的相册{refs.length?` · ${refs.length} 条记录`:""}</Text>
    {!valid?<Text style={s.error}>账号或家庭已变化，请重新选择内容。</Text>:<><Button title="新建本机相册" onPress={()=>void create()}/>
    {locals.map(a=><Button key={a.id} title={`${a.title} · 仅本机`} disabled={busy||refs.some(r=>r.scope!==a.scope&&!(r.kind==="localDraft"&&r.scope==="local"))} onPress={()=>void choose("localAlbum",a.id,a.scope)}/>)}
    {(offline?downloads.map(e=>({id:e.id,title:e.title,revision:e.manifest.revision})):page?.entries??[]).map(a=><Button key={a.id} title={a.title} disabled={busy||(!offline&&!page?.canWrite&&!!refs.length)} onPress={()=>void choose("collection",a.id,scope!,a.revision)}/>)}
    {page?.nextCursor?<Button title="更多相册" disabled={loading} onPress={()=>void load(page.nextCursor!)}/>:null}</>}
    {error||loadError?<Text style={s.error}>{error||loadError}</Text>:null}
  </ScrollView>;
}
export function CollectionDetailScreen(props: NativeStackScreenProps<RootStackParamList, "CollectionDetail">) {
  const {credentials,userId,viewer,family}=useAppData();
  const scope=draftReadingScope(credentials,userId,viewer?.id,family?.id);
  const s=useSharedStyles();
  if(!scope||scope==="local")return <View style={s.empty}><Text style={s.body}>请先连接当前家庭。</Text></View>;
  return <CollectionDetailView key={JSON.stringify([scope,credentials?.token,props.route.params.id])} {...props}/>;
}
function CollectionDetailView({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "CollectionDetail">) {
  const s = useSharedStyles();
  const { credentials,userId,viewer,family } = useAppData();
  const scope=draftReadingScope(credentials,userId,viewer?.id,family?.id);
  const confirm = useConfirmSheet();
  const [reading, setReading] = useState(true);
  const [pendingAlbum,setPendingAlbum]=useState<LocalAlbum|null>(null);
  const [moreVisible, setMoreVisible] = useState(false);
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
      if(scope)setPendingAlbum((await listLocalAlbums(scope)).find(a=>a.remoteId===next.id&&a.pending)??null);
      dirty.current = false;
      setError("");
      setStatus("");
    } catch (e) {
      if(e instanceof ApiError&&[401,403,404].includes(e.status)){
        setDoc(null);setPendingAlbum(null);dirty.current=false;
        if(e.status!==404)await invalidateReadingCredentials(credentials).catch(()=>{});
        else try{const cached=await resolveReadingScope(credentials,{offline:true});await readingDownloads.remove(`${cached.scope.key}/collection-${route.params.id}`,nativeReadingTransport(credentials,cached.scope));}catch{/* The denied server contents remain hidden even when cache cleanup fails. */}
      }
      setError((e as Error).message);
    }
  }, [credentials, route.params.id,scope]);
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
      if(e instanceof ApiError&&[401,403,404].includes(e.status)){setDoc(null);setPendingAlbum(null);dirty.current=false;}
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
  async function addContents() {
    if(!doc||!scope||scope==="local"||busy)return;
    if(dirty.current&&!await save())return;
    const session=await createWorkSession(scope,{mode:"append",kind:"collection",id:doc.id,revision:doc.revision});
    navigation.navigate("MaterialPicker",{scope,sessionId:session.id});
  }
  async function startFamilyViewing() {
    if (!doc || doc.deletedAt || busy) return;
    if (dirty.current && !await save()) return;
    setMoreVisible(false);
    navigation.navigate("FamilyViewing", { collectionId: doc.id });
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={[s.title, { flex: 1 }]}>{doc.title}</Text>
        {!doc.deletedAt ? <ActionButton title="更多" variant="ghost" full={false} onPress={() => setMoreVisible(true)} /> : null}
      </View>
      <GlassSheet visible={moreVisible} onClose={() => setMoreVisible(false)}>
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={s.cardTitle}>相册操作</Text><IconButton icon="close" label="关闭相册更多" onPress={() => setMoreVisible(false)} /></View>
          <Text style={s.body}>给家人看时，只浏览这个相册。长按退出并确认后，恢复完整操作。</Text>
          <ActionButton title={busy ? "正在保存…" : "给家人看"} icon="users" variant="primary" disabled={busy || Boolean(doc.deletedAt)} onPress={() => void startFamilyViewing()} />
          <Text style={s.body}>已下载的相册也能离线观看。这是临时观看界面，不会锁定手机。</Text>
        </View>
      </GlassSheet>
      {pendingAlbum?<ActionButton title="查看待加入的记录" onPress={()=>navigation.navigate("LocalAlbum",{id:pendingAlbum.id,scope:pendingAlbum.scope})}/>:null}
      {doc.canWrite && !doc.deletedAt ? <ActionButton title="添加记录" variant="primary" disabled={busy} onPress={() => void addContents().catch(e=>setError(e.message))} /> : null}
      {doc.canWrite && !doc.deletedAt ? (
        <Button
          title={reading ? "整理" : "完成整理"}
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
