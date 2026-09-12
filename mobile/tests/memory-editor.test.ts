import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MobileMemory } from "../src/types";
const mocks = vi.hoisted(() => ({ patch: vi.fn(), fetch: vi.fn(), share: vi.fn(), queued: vi.fn(), online: true }));
vi.mock("react-native", () => ({ Text: "Text", TextInput: "TextInput", Pressable: "Pressable", View: "View", Modal: "Modal", Platform: { OS: "ios" }, StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("@react-native-community/datetimepicker", () => ({ default: "DateTimePicker", DateTimePickerAndroid: { open: vi.fn() } }));
const credentials = { serverUrl: "https://fixture.invalid", token: "synthetic", instanceId: "instance" };
vi.mock("../src/state/AppContext", () => {
  const useApp = () => ({ credentials, online: mocks.online, viewer: { id: "author" }, family: { id: "family", timezone: "UTC" },
    people: [{ id: "person-b", displayName: "家人B" }], queued: mocks.queued, reloadLocal: async () => {} });
  return { useApp, useAppData: useApp, useAppActions: useApp, useSyncStatus: useApp };
});
vi.mock("../src/api/client", async original => ({ ...await original<object>(), patchMobileMemory: mocks.patch, fetchMobileMemory: mocks.fetch, shareMobileMemory: mocks.share,
  requestMobileJson: vi.fn().mockResolvedValue({ members: [{ id: "user-b", name: "家人B" }] }) }));
const { MemoryEditor } = await import("../src/memories/MemoryEditor");
const { ApiError } = await import("../src/api/client");
const { initializeLocalStore, clearLocalArchive } = await import("../src/storage/database");
const { getMemoryEdit, drainMemoryEditWrites } = await import("../src/memories/edit-store");
const { memoryEditScope } = await import("../src/memories/edit-model");
const { syncMemoryEdits } = await import("../src/memories/edit-sync");
const { getRawMockDatabase } = await import("../../tests/mocks/expo-sqlite");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const scope = memoryEditScope(credentials, "author", "family")!;
const memory: MobileMemory = { id: "event", title: "旧事", bodyText: "原始正文", titleRevision: 3, canWrite: true, isAuthor: true, visibility: "private", readerUserIds: [],
  occurredAt: "1988-01-01T00:00:00.000Z", occurredAtWall: "1988-01-01T00:00", occurredAtPrecision: "unknown", ageDays: null, ageLabel: null, locationText: null, childPersonId: null, participantPersonIds: [], participants: [], sourceNotes: [], assets: [], contributions: [], updatedAt: "2026-09-08T00:00:00.000Z" };
let tree: ReactTestRenderer | undefined;
const saved = vi.fn().mockResolvedValue(undefined);
async function open(value = memory) { await act(async () => { tree = create(createElement(MemoryEditor, { memory: value, onSaved: saved })); }); }
async function press(label: string) {
  const button = tree!.root.findAllByType("Pressable" as never).find(node => node.findAllByType("Text" as never).some(text => text.children.join("") === label));
  expect(button, label).toBeDefined();
  expect(button!.props.disabled, label).not.toBe(true);
  await act(async () => { await button!.props.onPress(); await drainMemoryEditWrites(); });
}
async function write(text: string) {
  await act(async () => { tree!.root.findByProps({ accessibilityLabel: "记忆正文" }).props.onChangeText(text); await drainMemoryEditWrites(); });
}
beforeEach(async () => {
  await drainMemoryEditWrites(); await initializeLocalStore(); await clearLocalArchive();
  mocks.patch.mockReset(); mocks.fetch.mockReset(); mocks.share.mockReset(); mocks.queued.mockReset().mockResolvedValue(undefined);
  saved.mockReset().mockResolvedValue(undefined); mocks.online = true;
  await open();
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; await drainMemoryEditWrites(); });

it("persists offline input across editor reopening and sends it only after an explicit save", async () => {
  mocks.online = false;
  await act(async () => tree!.update(createElement(MemoryEditor, { memory, onSaved: saved })));
  await press("修改这件事"); await write("断网时补写，退出也不能丢");
  expect((await getMemoryEdit(scope, memory.id))?.savedContent).toBeNull();
  expect(mocks.queued).not.toHaveBeenCalled();
  await act(async () => tree!.unmount()); tree = undefined;
  await initializeLocalStore(); await open();
  await press("继续修改这件事");
  expect(tree!.root.findByProps({ accessibilityLabel: "记忆正文" }).props.value).toBe("断网时补写，退出也不能丢");
  await press("保存记忆修改");
  expect((await getMemoryEdit(scope, memory.id))?.savedContent?.bodyText).toBe("断网时补写，退出也不能丢");
  expect(mocks.queued).toHaveBeenCalledOnce();
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).toContain("已保存在本机");
});

it("lets the owner continue typing while a prior saved snapshot is syncing without losing either version", async () => {
  await press("修改这件事"); await write("先保存的第一句"); await press("保存记忆修改");
  let finish!: (memory: MobileMemory) => void;
  mocks.patch.mockReturnValueOnce(new Promise<MobileMemory>(resolve => { finish = resolve; }));
  let running!: Promise<unknown>;
  await act(async () => { running = syncMemoryEdits(credentials, scope, "author", "family", () => true); });
  await press("继续修改这件事"); await write("等待时补写的第二句");
  expect(tree!.root.findByProps({ accessibilityLabel: "记忆正文" }).props.editable).toBe(true);
  await act(async () => { finish({ ...memory, bodyText: "先保存的第一句", titleRevision: 4 }); await running; });
  expect(tree!.root.findByProps({ accessibilityLabel: "记忆正文" }).props.value).toBe("等待时补写的第二句");
  expect(await getMemoryEdit(scope, memory.id)).toMatchObject({ content: { bodyText: "等待时补写的第二句" }, baseRevision: 4, savedContent: null });
});

it.each([false, true])("pins the revision opened by the owner when a family refresh arrives before input (typing: %s)", async typing => {
  await press("修改这件事");
  await act(async () => tree!.update(createElement(MemoryEditor, { memory: { ...memory, bodyText: "家人刚更新的正文", titleRevision: 4 }, onSaved: saved })));
  if (typing) await write("基于旧内容补写");
  await press("保存记忆修改");
  expect(await getMemoryEdit(scope, memory.id)).toMatchObject({ baseRevision: 3, base: { bodyText: "原始正文" },
    savedContent: { bodyText: typing ? "基于旧内容补写" : "原始正文" } });
});

it("shows both conflict versions and resubmits only after the owner's explicit choice", async () => {
  await press("修改这件事"); await write("我的补充不能丢"); await press("保存记忆修改");
  mocks.patch.mockRejectedValueOnce(new ApiError("changed", 409));
  mocks.fetch.mockResolvedValueOnce({ ...memory, bodyText: "另一位家人写的", titleRevision: 7 });
  await act(async () => { await syncMemoryEdits(credentials, scope, "author", "family", () => true); });
  expect(JSON.stringify(tree!.toJSON())).toContain("我的补充不能丢");
  expect(JSON.stringify(tree!.toJSON())).toContain("另一位家人写的");
  expect(mocks.patch).toHaveBeenCalledOnce();
  await press("保留我的修改，重新保存");
  expect(await getMemoryEdit(scope, memory.id)).toMatchObject({ baseRevision: 7, conflict: null, savedContent: { bodyText: "我的补充不能丢" } });
  expect(mocks.queued).toHaveBeenCalledTimes(2);
});

it("keeps sharing changes online and preserves the chosen scope during a network failure", async () => {
  await press("管理分享"); await press("指定家人"); await press("家人B");
  mocks.online = false;
  await act(async () => tree!.update(createElement(MemoryEditor, { memory, onSaved: saved })));
  await press("保存分享设置");
  expect(mocks.share).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).toContain("读者范围需要联网核验");
  mocks.online = true;
  await act(async () => tree!.update(createElement(MemoryEditor, { memory, onSaved: saved })));
  await press("保存分享设置");
  expect(mocks.share.mock.calls[0]![2]).toMatchObject({ visibility: "members", readerUserIds: ["user-b"], expectedRevision: 3 });
});

it("keeps native input visible when SQLite fails and recovers on an explicit save", async () => {
  await press("修改这件事");
  const db = getRawMockDatabase();
  db.exec("CREATE TRIGGER deny_edit BEFORE INSERT ON local_memory_edit BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  try {
    await write("磁盘错误也不能把输入清空");
    expect(tree!.root.findByProps({ accessibilityLabel: "记忆正文" }).props.value).toBe("磁盘错误也不能把输入清空");
    expect(await getMemoryEdit(scope, memory.id)).toBeNull();
    expect(JSON.stringify(tree!.toJSON())).toContain("disk full");
  } finally { db.exec("DROP TRIGGER deny_edit"); }
  await press("保存记忆修改");
  expect((await getMemoryEdit(scope, memory.id))?.savedContent?.bodyText).toBe("磁盘错误也不能把输入清空");
});
