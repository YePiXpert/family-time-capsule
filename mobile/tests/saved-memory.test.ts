import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Credentials } from "../src/types";
const mocks = vi.hoisted(() => ({ credentials: null as Credentials | null, userId: null as string | null, family: null as { id: string } | null, permission: 0, exists: true, navigate: vi.fn(), queued: vi.fn(), reloadLocal: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, ActivityIndicator: "ActivityIndicator", Text: "Text", TextInput: "TextInput", View: "View", ScrollView: "ScrollView", Pressable: "Pressable", StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } }));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "Icon" }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) }));
vi.mock("../src/state/AppContext", () => ({ useAppActions: () => ({ queued: mocks.queued, reloadLocal: mocks.reloadLocal }), useAppData: () => ({ ...mocks, viewer: mocks.userId ? { id: mocks.userId, canCapture: true } : null, people: [] }), useSyncStatus: () => ({ syncing: false }) }));
vi.mock("../src/storage/cache-lifecycle", () => ({ useServerPermissionRevision: () => mocks.permission }));
vi.mock("../src/storage/files", () => ({ localFileExists: () => mocks.exists }));
vi.mock("../src/api/client", () => ({ requestMobileJson: vi.fn() }));
vi.mock("../src/screens/MemoryScreen", () => ({ MemoryScreen: (props: object) => createElement("PermittedMemory", props) }));
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: "NativeMediaReader" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
const { SavedMemoryScreen } = await import("../src/screens/SavedMemoryScreen");
const { initializeLocalStore } = await import("../src/storage/database");
const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");
const drafts = await import("../src/drafts/store");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const render = (scope = "local") => createElement(SavedMemoryScreen, { route: { key: "reading", name: "SavedMemory", params: { draftId: "saved-story", scope } }, navigation: { navigate: mocks.navigate } } as never);
const output = () => JSON.stringify(tree!.toJSON());
beforeEach(async () => {
  mocks.credentials = null; mocks.userId = null; mocks.family = null; mocks.permission = 0; mocks.exists = true; vi.clearAllMocks();
  await initializeLocalStore(); getRawMockDatabase().exec("DELETE FROM local_draft; DELETE FROM local_capture");
});
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; vi.restoreAllMocks(); });
async function seed(scope = "local") {
  const row = await drafts.createLocalDraft(scope, "saved-story", "saved-mutation");
  const saved = { ...row, revision: 2, status: "queued" as const, content: { ...row.content, title: "那天的海边", text: "沙滩上留下的小脚印", visibility: "private" as const, items: [{ id: "photo-item", localCaptureRef: "photo", assetId: null, caption: "" }] } };
  await drafts.saveLocalDraft(saved, 1, { id: "photo", payload: { localUri: "file:///sea.jpg", fileName: "sea.jpg", mediaType: "image", mimeType: "image/jpeg", source: "library", lastModified: null } });
  return saved;
}
it("reads a saved offline story after restart and returns to the existing composer for a supplement", async () => {
  await seed(); await initializeLocalStore();
  await act(async () => { tree = create(render()); });
  expect(output()).toContain("沙滩上留下的小脚印"); expect(output()).toContain("仅自己可见");
  expect(tree!.root.findAllByType("TextInput" as never)).toHaveLength(0);
  expect(tree!.root.findByType("NativeMediaReader" as never).props.assets[0]).toMatchObject({ localUri: "file:///sea.jpg", type: "image" });
  await act(() => tree!.root.findByProps({ testID: "record-edit" }).props.onPress());
  expect(mocks.navigate).toHaveBeenCalledWith("Capture", { scope: "local", target: { kind: "local", draftId: "saved-story", editSaved: true } });
});
it("reads the previous saved snapshot and reports a missing original without losing the story", async () => {
  const saved = await seed();
  await drafts.saveLocalDraft({ ...saved, status: "editing", revision: 3, savedContent: saved.content, content: { ...saved.content, text: "未完成补记", items: [] } }, 2);
  mocks.exists = false;
  await act(async () => { tree = create(render()); });
  expect(output()).toContain("沙滩上留下的小脚印"); expect(output()).not.toContain("未完成补记");
  expect(tree!.root.findAllByType("Text" as never).map(node => node.children.join("")).join("\n")).toContain("1 份素材暂时无法读取"); expect(output()).toContain("继续编辑");
  expect(tree!.root.findAllByType("NativeMediaReader" as never)).toHaveLength(0);
});
it("hands published records to the permission-checked family reader and never revives discarded drafts", async () => {
  const row = await seed();
  await drafts.saveLocalDraft({ ...row, revision: 3, status: "published", memoryEventId: "server-story" }, 2);
  await act(async () => { tree = create(render()); });
  expect(tree!.root.findByType("PermittedMemory" as never).props.route.params.id).toBe("server-story");
  expect(output()).not.toContain("沙滩上留下的小脚印");
  await drafts.saveLocalDraft({ ...row, revision: 4, status: "discarded" }, 3);
  mocks.permission++;
  await act(async () => tree!.update(render()));
  expect(output()).toContain("找不到已保存的记录");
  expect(output()).not.toContain("沙滩上留下的小脚印");
});
it("hides an account's story immediately when the active family changes, including late reads", async () => {
  mocks.credentials = { serverUrl: "https://fixture.invalid", instanceId: "instance", token: "session" }; mocks.userId = "owner"; mocks.family = { id: "family-a" };
  const scope = JSON.stringify([mocks.credentials.serverUrl, "instance", "owner", "family-a"]);
  const saved = await seed(scope);
  let finish!: (rows: typeof saved[]) => void;
  vi.spyOn(drafts, "listLocalDrafts").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { tree = create(render(scope)); });
  mocks.family = { id: "family-b" };
  await act(async () => tree!.update(render(scope)));
  await act(async () => finish([saved]));
  expect(output()).toContain("请回到保存这条记录的家庭");
  expect(output()).not.toContain("沙滩上留下的小脚印");
});

it("marks a saved offline record without replacing an unfinished supplement or creating another story", async () => {
  const row = await seed();
  await drafts.saveLocalDraft({ ...row, revision: 3, status: "editing", savedContent: row.content, content: { ...row.content, text: "尚未提交的补充" } }, 2);
  await act(async () => { tree = create(render()); });
  await act(async () => tree!.root.findByProps({ testID: "record-first" }).props.onPress());
  const updated = (await drafts.listLocalDrafts("local"))[0]!;
  expect(updated).toMatchObject({ status: "editing", content: { text: "尚未提交的补充", milestoneType: "first_time" }, savedContent: { text: "沙滩上留下的小脚印", milestoneType: "first_time" } });
  expect(await drafts.listLocalDrafts("local")).toHaveLength(1);
  expect(output()).not.toContain("尚未提交的补充");
});
