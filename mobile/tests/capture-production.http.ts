import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterAll, afterEach, expect, it, vi } from "vitest";

const fixture = JSON.parse(process.env.FTC_NATIVE_HTTP_FIXTURE!);
const mocks = vi.hoisted(() => ({
  constructor: vi.fn(), permission: vi.fn(), audioMode: vi.fn(), prepare: vi.fn(), record: vi.fn(), stop: vi.fn(), release: vi.fn(),
  documentPicker: vi.fn(), preserveDocument: vi.fn(), cameraPermission: vi.fn(), camera: vi.fn(), library: vi.fn(), preserveMedia: vi.fn(), preserveAudio: vi.fn(), removeFile: vi.fn(),
  setParams: vi.fn(), route: { params: {} }, grantSyncConsent: vi.fn().mockResolvedValue(undefined), queued: vi.fn(),
}));
vi.mock("react-native", () => ({
  Image: "Image", ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView",
  Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: "ios", select: (v: { ios: unknown }) => v.ios },
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
  useNavigation: () => navigation,
  useRoute: () => mocks.route,
}));
const navigation = { setParams: mocks.setParams };
vi.mock("../src/state/AppContext", () => ({ useApp: () => ({
  credentials: fixture.credentials, family: fixture.family, userId: fixture.userId,
  people: fixture.people, viewer: { canCapture: true, canEditEvents: true },
  outbox: [], queued: mocks.queued, grantSyncConsent: mocks.grantSyncConsent,
}) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-audio", () => {
  class Recorder {
    constructor(options: unknown) { mocks.constructor(options); }
    uri = "file:///recording.m4a";
    prepareToRecordAsync = mocks.prepare;
    record = mocks.record;
    stop = mocks.stop;
    release = mocks.release;
  }
  return {
    AudioModule: { AudioRecorder: Recorder },
    // Model the former eager hook too, so this suite reproduces the old render crash.
    useAudioRecorder: () => new Recorder({}),
    RecordingPresets: { HIGH_QUALITY: { extension: ".m4a", ios: { outputFormat: "aac" } } },
    requestRecordingPermissionsAsync: mocks.permission,
    setAudioModeAsync: mocks.audioMode,
  };
});
vi.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: mocks.cameraPermission,
  launchCameraAsync: mocks.camera, launchImageLibraryAsync: mocks.library,
  UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
  UIImagePickerControllerQualityType: { High: "high" },
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: mocks.documentPicker }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("expo-file-system", async () => {
  const fs = await import("node:fs");
  return {
    Directory: class {},
    File: class {
      constructor(readonly uri: string) {}
      get exists() { return fs.existsSync(this.uri); }
      get size() { return fs.statSync(this.uri).size; }
      open() { const fd = fs.openSync(this.uri, "r"); return { offset: 0,
        readBytes(size: number) { const bytes = Buffer.alloc(size); const n = fs.readSync(fd, bytes, 0, size, this.offset); this.offset += n; return bytes.subarray(0,n); },
        close() { fs.closeSync(fd); }
      }; }
    }, FileMode: { ReadOnly: 0 }, Paths: { document: "/unused-device-sandbox" }
  };
});
vi.mock("expo-media-library", () => ({ Asset: class {} }));
vi.mock("../src/storage/files", async importOriginal => ({
  ...await importOriginal<typeof import("../src/storage/files")>(),
  preparePickedMedia: mocks.preserveMedia, preservePreparedMedia: vi.fn().mockResolvedValue(undefined), preservePickedMedia: mocks.preserveMedia, preserveRecordedAudio: mocks.preserveAudio,
  preservePickedDocument: mocks.preserveDocument, removeLocalFile: mocks.removeFile,
}));
vi.mock("../src/native/picker-intake", () => ({ beginPickerReceipt: vi.fn(), finishPickerReceipt: vi.fn() }));
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: "NativeMediaReader" }));
vi.mock("../src/components/DateTimeField", () => ({ DateTimeField: "DateTimeField" }));
vi.mock("@react-native-community/datetimepicker", () => ({
  DateTimePickerAndroid: { open: vi.fn() },
  default: "DateTimePicker",
}));

const { CaptureScreen } = await import("../src/screens/CaptureScreen");
const { initializeLocalStore, setActiveDestination } = await import("../src/storage/database");
const { listLocalDrafts } = await import("../src/drafts/store");
const { syncLocalIntake } = await import("../src/native/intake-sync");
const { syncLocalDrafts } = await import("../src/drafts/sync");
const { requestMobileJson } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); });
async function press(label: string) {
  const node = tree!.root.findAllByType("Pressable" as never).find(n => n.findAllByType("Text" as never).some(t => t.children.join("") === label));
  expect(node, label).toBeDefined();
  await act(async () => { node!.props.onPress(); });
}
it("R01/R02/R03: real native recording hook → HTTP DTO → production API → SQLite → reader isolation", async () => {
  await initializeLocalStore();
  const scope = JSON.stringify([fixture.credentials.serverUrl, fixture.credentials.instanceId, fixture.userId, fixture.family.id]);
  await setActiveDestination(scope);
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  // Real network requests are outside React's synchronous render lifetime.
  await expect.poll(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    return tree!.root.findByProps({ testID: "capture-text" }).props.editable;
  }).toBe(true);
  await act(async () => tree!.root.findByProps({ testID: "capture-text" }).props.onChangeText("日期不详的江边往事"));
  await press("不详");
  await press("指定成员");
  await expect.poll(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    return tree!.root.findAllByType("Pressable" as never).filter(n => n.props.accessibilityRole === "checkbox").length;
  }).toBe(fixture.people.length + fixture.readerCount);
  const boxes = tree!.root.findAllByType("Pressable" as never).filter(n => n.props.accessibilityRole === "checkbox");
  const readers = boxes.slice(fixture.people.length);
  expect(readers.some(n => n.findAllByType("Text" as never).some(t => t.children.join("") === "外公"))).toBe(false);
  const reader = readers.find(n => n.findAllByType("Text" as never).some(t => t.children.join("") === "妈妈"));
  await act(async () => reader!.props.onPress());
  await act(async () => boxes[1]!.props.onPress());
  await press("保存为一条记忆");
  expect(mocks.grantSyncConsent).toHaveBeenCalledOnce();
  const before = (await listLocalDrafts(scope))[0]!;
  expect(before).toMatchObject({ status: "queued", content: { readerUserIds: ["user-b"], participantIds: ["person-no-account"], occurredAtPrecision: "unknown", occurredAt: null } });
  await act(async () => tree!.unmount()); tree = undefined;
  await initializeLocalStore();
  expect((await listLocalDrafts(scope))[0]).toEqual(before);
  await syncLocalDrafts(fixture.credentials, { authorizeUpload: async () => true });
  const published = (await listLocalDrafts(scope))[0]!;
  expect(published.status).toBe("published");
  expect(published.content.occurredAt).toBeNull();
  const url = `/api/mobile/v1/memories/${published.memoryEventId}`;
  expect(await requestMobileJson(fixture.credentials, url)).toMatchObject({ occurredAtPrecision: "unknown" });
  expect(await requestMobileJson({ ...fixture.credentials, token: fixture.readerToken }, url)).toMatchObject({ id: published.memoryEventId });
  await expect(requestMobileJson({ ...fixture.credentials, token: fixture.thirdToken }, url)).rejects.toMatchObject({ status: 404 });
}, 30000);

const originalDirectory = mkdtempSync(path.join(tmpdir(), "ftc-native-originals-"));
afterAll(() => rmSync(originalDirectory, { recursive: true, force: true }));
it("R04/R05/R06: private native photos and audio survive local restart and a lost complete receipt without any family inbox", async () => {
  await initializeLocalStore();
  const scope = JSON.stringify([fixture.credentials.serverUrl, fixture.credentials.instanceId, fixture.userId, fixture.family.id]);
  await setActiveDestination(scope);
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await expect.poll(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve,20)); }); return tree!.root.findByProps({testID:"capture-text"}).props.editable; }).toBe(true);
  await act(async () => tree!.root.findByProps({testID:"capture-text"}).props.onChangeText("有两张照片与原声的私密往事"));
  await press("不详"); await press("仅自己");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1kAAAAASUVORK5CYII=", "base64");
  const media = [0,1].map(i => { const localUri = path.join(originalDirectory, `photo-${i}.png`); writeFileSync(localUri, Buffer.concat([png,Buffer.from(String(i))])); return {localUri,fileName:`photo-${i}.png`,mimeType:"image/png",lastModified:null,mediaType:"image",source:"library"}; });
  mocks.library.mockResolvedValue({canceled:false,assets:media.slice(0,1).map(m => ({uri:m.localUri,type:"image",fileName:m.fileName}))});
  mocks.preserveMedia.mockImplementation(async (picked: {uri:string}) => media.find(m => m.localUri === picked.uri));
  await press("从相册导入");
  mocks.documentPicker.mockResolvedValue({canceled:false,assets:[{uri:media[1]!.localUri,name:media[1]!.fileName,mimeType:"image/png"}]});
  mocks.preserveDocument.mockImplementation(async (_asset:unknown,_id:string,prepared:(p:unknown)=>void)=>{const payload={...media[1]!,source:"files"};prepared(payload);return payload;});
  await press("从 Files 导入");
  const pcmBytes=9*1024*1024;
  const wav = Buffer.alloc(44+pcmBytes); wav.write("RIFF",0); wav.writeUInt32LE(wav.length-8,4); wav.write("WAVEfmt ",8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(16000,24); wav.writeUInt32LE(32000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write("data",36); wav.writeUInt32LE(pcmBytes,40);
  for(let i=44;i<wav.length;i+=2) wav.writeInt16LE(Math.round(2000*Math.sin((i-44)*Math.PI*440/16000)),i);
  const audioUri=path.join(originalDirectory,"voice.wav"); writeFileSync(audioUri,wav);
  mocks.permission.mockResolvedValue({granted:true});
  mocks.preserveAudio.mockResolvedValue({localUri:audioUri,fileName:"voice.wav",mimeType:"audio/wav",lastModified:null,mediaType:"audio",source:"recorder"});
  await press("直接录音"); await press("完成录音");
  await expect.poll(async () => (await listLocalDrafts(scope)).find(d=>d.status === "editing")?.content.items.length).toBe(3);
  await press(`发送草稿到${fixture.family.name}`);
  const queued=(await listLocalDrafts(scope)).find(d=>d.status === "queued")!;
  expect(queued.content.visibility).toBe("private");
  await act(async()=>tree!.unmount()); tree=undefined;
  const fetcher=globalThis.fetch; let lost=false;
  globalThis.fetch=async (...args) => { const response=await fetcher(...args); if (!lost && String(args[0]).endsWith("/complete")) {lost=true; throw new Error("synthetic complete reply lost");} return response; };
  try { await expect(syncLocalDrafts(fixture.credentials,{authorizeUpload:async()=>true})).rejects.toThrow("synthetic complete reply lost"); } finally { globalThis.fetch=fetcher; }
  expect(lost).toBe(true);
  await initializeLocalStore();
  let chunkLost=false;
  globalThis.fetch=async (...args) => { const response=await fetcher(...args); if (!chunkLost && args[1]?.method === "PATCH" && Number((args[1].headers as Record<string,string>)["content-length"]) === 8*1024*1024) {chunkLost=true;throw new Error("synthetic large chunk reply lost");}return response; };
  try { await expect(syncLocalDrafts(fixture.credentials,{authorizeUpload:async()=>true})).rejects.toThrow("synthetic large chunk reply lost"); } finally {globalThis.fetch=fetcher;}
  expect(chunkLost).toBe(true);
  await initializeLocalStore();
  await syncLocalDrafts(fixture.credentials,{authorizeUpload:async()=>true});
  await syncLocalIntake(fixture.credentials,{authorizeUpload:async()=>true});
  const batches=await requestMobileJson(fixture.credentials,"/api/imports") as {sessions:{id:string}[]};
  expect(batches.sessions).toHaveLength(1);
  const batch=await requestMobileJson(fixture.credentials,`/api/imports/${batches.sessions[0]!.id}`);
  expect(batch).toMatchObject({session:{totalCount:1,completedCount:1},items:[{inboxItemId:null,status:"completed"}]});
  const synced=(await listLocalDrafts(scope)).find(d=>d.id===queued.id)!;
  expect(synced).toMatchObject({status:"editing",content:{visibility:"private",occurredAt:null,occurredAtPrecision:"unknown"}});
  expect(synced.content.items.every(i=>!!i.assetId)).toBe(true);
  expect(new Set(synced.content.items.map(i=>i.assetId)).size).toBe(3);
  expect(await requestMobileJson(fixture.credentials,`/api/mobile/v1/drafts/${synced.id}`)).toMatchObject({text:"有两张照片与原声的私密往事",status:"editing"});
  await expect(requestMobileJson({...fixture.credentials,token:fixture.thirdToken},`/api/mobile/v1/drafts/${synced.id}`)).rejects.toMatchObject({status:404});
  // Reopen the real capture hook to request publication after draft-only sync.
  await act(async()=>{tree=create(createElement(CaptureScreen));});
  await expect.poll(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});return tree!.root.findByProps({testID:"capture-text"}).props.value;}).toBe("有两张照片与原声的私密往事");
  await press("保存为一条记忆");
  await act(async()=>tree!.unmount());tree=undefined;
  await syncLocalDrafts(fixture.credentials,{authorizeUpload:async()=>true});
  const published=(await listLocalDrafts(scope)).find(d=>d.id===queued.id)!;
  expect(published.status).toBe("published");
  expect(await requestMobileJson(fixture.credentials,`/api/mobile/v1/memories/${published.memoryEventId}`)).toMatchObject({occurredAtPrecision:"unknown"});
  for(const token of [fixture.readerToken,fixture.thirdToken]) await expect(requestMobileJson({...fixture.credentials,token},`/api/mobile/v1/memories/${published.memoryEventId}`)).rejects.toMatchObject({status:404});
},30000);


it("private Live Photo stays paired when motion upload is interrupted and its complete reply is lost", async () => {
  const { createHash } = await import("node:crypto");
  await initializeLocalStore();
  const scope = JSON.stringify([fixture.credentials.serverUrl, fixture.credentials.instanceId, fixture.userId, fixture.family.id]);
  await setActiveDestination(scope);
  await act(async () => { tree = create(createElement(CaptureScreen)); });
  await expect.poll(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve,20)); }); return tree!.root.findByProps({testID:"capture-text"}).props.editable; }).toBe(true);
  await act(async () => tree!.root.findByProps({testID:"capture-text"}).props.onChangeText("Live Photo 私密原件配对"));
  await press("不详"); await press("仅自己");
  const media = ["sample.jpg", "sample.mov"].map((name, i) => {
    const localUri = path.join(originalDirectory, name);
    writeFileSync(localUri, readFileSync(path.join(process.cwd(), "../tests/fixtures", name)));
    return { localUri, fileName: name, mimeType: i ? "video/quicktime" : "image/jpeg", lastModified: null, mediaType: i ? "video" : "image", source: "library" };
  });
  mocks.library.mockResolvedValue({ canceled: false, assets: [{ uri: media[0]!.localUri, type: "livePhoto", pairedVideoAsset: { uri: media[1]!.localUri, type: "pairedVideo" } }] });
  mocks.preserveMedia.mockImplementation(async (picked: {uri: string}) => media.find(m => m.localUri === picked.uri));
  await press("从相册导入");
  await expect.poll(async () => (await listLocalDrafts(scope)).find(d => d.status === "editing")?.content.items.length).toBe(2);
  await press("保存为一条记忆");
  const queued = (await listLocalDrafts(scope)).find(d => d.status === "queued")!;
  await act(async () => tree!.unmount()); tree = undefined;
  const originalFetch = globalThis.fetch; let motionUpload = "", interrupted = false, completeLost = false;
  globalThis.fetch = async (...args) => {
    if (motionUpload && String(args[0]).endsWith(motionUpload) && args[1]?.method === "PATCH" && !interrupted) { interrupted = true; throw new Error("motion connection interrupted"); }
    const response = await originalFetch(...args);
    if (String(args[0]).endsWith("/api/uploads") && String(args[1]?.body).includes("video/quicktime")) motionUpload = (await response.clone().json()).uploadId;
    if (motionUpload && String(args[0]).endsWith(`${motionUpload}/complete`) && !completeLost) { completeLost = true; throw new Error("motion complete reply lost"); }
    return response;
  };
  try {
    await expect(syncLocalDrafts(fixture.credentials, { authorizeUpload: async () => true })).rejects.toThrow("motion connection interrupted");
    const half = (await listLocalDrafts(scope)).find(d => d.id === queued.id)!;
    expect(half.content.items.map(i => !!i.assetId)).toEqual([true,false]);
    expect(half.status).toBe("queued");
    await initializeLocalStore();
    await expect(syncLocalDrafts(fixture.credentials, { authorizeUpload: async () => true })).rejects.toThrow("motion complete reply lost");
    await initializeLocalStore();
    await syncLocalDrafts(fixture.credentials, { authorizeUpload: async () => true });
  } finally { globalThis.fetch = originalFetch; }
  expect(interrupted && completeLost).toBe(true);
  const published = (await listLocalDrafts(scope)).find(d => d.id === queued.id)!;
  expect(published.status).toBe("published");
  expect(published.content.items.map(i => i.livePhotoRole)).toEqual(["image", "video"]);
  const detail = await requestMobileJson(fixture.credentials, `/api/mobile/v1/memories/${published.memoryEventId}`);
  expect(detail).toMatchObject({ livePhotos: [{ groupId: queued.content.items[0]!.livePhotoGroupId, imageAssetId: published.content.items[0]!.assetId, videoAssetId: published.content.items[1]!.assetId }] });
  for (const [i,item] of published.content.items.entries()) {
    const response = await fetch(`${fixture.credentials.serverUrl}/api/media/${item.assetId}`, { headers: { authorization: `Bearer ${fixture.credentials.token}` } });
    expect(response.status).toBe(200);
    expect(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex")).toBe(createHash("sha256").update(readFileSync(media[i]!.localUri)).digest("hex"));
    for (const token of [fixture.readerToken, fixture.thirdToken]) expect((await fetch(`${fixture.credentials.serverUrl}/api/media/${item.assetId}`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  }
}, 30000);
