import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), consent: vi.fn(), queued: vi.fn(), account: "a", viewer: false, sequence: 0 }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: (s: unknown) => s } }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `intake-screen-${++mocks.sequence}` }));
vi.mock("../src/media/NativeMediaReader", () => ({ NativeMediaReader: "NativeMediaReader" }));
vi.mock("../src/state/AppContext", () => { const useApp = () => ({ credentials: { serverUrl: "https://fixture.invalid", instanceId: "instance", token: "fictional" }, userId: mocks.account, family: { id: "family", name: "测试家庭" }, viewer: { role: mocks.viewer ? "viewer" : "admin", canCapture: !mocks.viewer }, queued: mocks.queued, grantSyncConsent: mocks.consent, syncConsent: null }); return { useApp, useAppData: useApp, useAppActions: useApp, useSyncStatus: useApp }; });
const { initializeLocalStore, ingestLocalImportSession } = await import("../src/storage/database");
const { LocalIntakeScreen } = await import("../src/screens/LocalIntakeScreen");
const { listLocalDrafts } = await import("../src/drafts/store");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; mocks.viewer = false; mocks.account = "a"; });
const scope = JSON.stringify(["https://fixture.invalid", "instance", "a", "family"]);
function props(id: string) { return { route: { key: id, name: "LocalIntake", params: { id } }, navigation: { navigate: mocks.navigate } } as unknown as Parameters<typeof LocalIntakeScreen>[0]; }
function button(label: string) { return tree!.root.findAll(node => node.type === "Pressable" as unknown && node.findAllByType("Text" as never).some(text => text.children.join("").includes(label)))[0]!; }
it("continues a mixed receipt after leaving the screen, without waiting for network or publishing an isolated event", async () => {
  await initializeLocalStore();
  await ingestLocalImportSession({ id: "screen-mixed", source: "share", scope, createdAt: "2026-09-07T00:00:00Z", queue: false, items: [{ externalId: "text", captureId: "screen-text", kind: "text", payload: { text: "外公留下的那段故事" } }, { externalId: "audio", captureId: "screen-audio", kind: "file", payload: { localUri: "file:///private/story.wav", fileName: "讲述.wav", mimeType: "audio/wav", mediaType: "audio", lastModified: null, source: "system_share" } }] });
  await act(async () => { tree = create(createElement(LocalIntakeScreen, props("screen-mixed"))); });
  expect(tree!.root.findAllByType("NativeMediaReader" as never)).toHaveLength(1);
  await act(async () => { await button("加入新草稿").props.onPress(); });
  const draft = (await listLocalDrafts(scope))[0]!;
  expect(draft.content.text).toBe("外公留下的那段故事");
  expect(draft.content.items).toHaveLength(1);
  expect(draft.status).toBe("editing");
  expect(mocks.consent).not.toHaveBeenCalled();
  expect(mocks.navigate).toHaveBeenCalledWith("MainTabs", expect.objectContaining({ screen: "Capture", params: expect.objectContaining({ localDraftId: draft.id }) }));
  await act(async () => { tree!.unmount(); tree = create(createElement(LocalIntakeScreen, props("screen-mixed"))); });
  expect(button("继续这件事")).toBeDefined();
  mocks.account = "b";
  await act(async () => { tree!.update(createElement(LocalIntakeScreen, props("screen-mixed"))); });
  expect(JSON.stringify(tree!.toJSON())).not.toContain("外公留下的那段故事");
});
it("keeps a viewer's received originals readable while offering no family write operation", async () => {
  mocks.viewer = true;
  await initializeLocalStore();
  await ingestLocalImportSession({ id: "viewer-receipt", source: "share", scope, createdAt: "2026-09-07T00:00:00Z", queue: false, items: [{ externalId: "text", captureId: "viewer-text", kind: "text", payload: { text: "先留在我自己的手机" } }] });
  await act(async () => { tree = create(createElement(LocalIntakeScreen, props("viewer-receipt"))); });
  expect(JSON.stringify(tree!.toJSON())).toContain("先留在我自己的手机");
  expect(JSON.stringify(tree!.toJSON())).toContain("尚未授权上传");
  expect(tree!.root.findAllByType("Pressable" as never)).toHaveLength(0);
});
