import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MobileMemory } from "../src/types";
const mocks = vi.hoisted(() => ({ patch: vi.fn(), share: vi.fn(), online: true }));
vi.mock("react-native", () => ({ Text: "Text", TextInput: "TextInput", Pressable: "Pressable", View: "View", Modal: "Modal", Platform: { OS: "ios" }, StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("@react-native-community/datetimepicker", () => ({ default: "DateTimePicker", DateTimePickerAndroid: { open: vi.fn() } }));
const credentials = { serverUrl: "https://fixture.invalid", token: "synthetic" };
vi.mock("../src/state/AppContext", () => { const useApp = () => ({ credentials, online: mocks.online, family: { timezone: "UTC" }, people: [{ id: "person-b", displayName: "家人B" }] }); return { useApp, useAppData: useApp, useAppActions: useApp, useSyncStatus: useApp }; });
vi.mock("../src/api/client", async original => ({ ...await original<object>(), patchMobileMemory: mocks.patch, shareMobileMemory: mocks.share, requestMobileJson: vi.fn().mockResolvedValue({ members: [{ id: "user-b", name: "家人B" }] }) }));
const { MemoryEditor } = await import("../src/memories/MemoryEditor");
const { ApiError } = await import("../src/api/client");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const memory: MobileMemory = { id: "event", title: "旧事", bodyText: "原始正文", titleRevision: 3, canWrite: true, isAuthor: true, visibility: "private", readerUserIds: [],
  occurredAt: "1988-01-01T00:00:00.000Z", occurredAtWall: "1988-01-01T00:00", occurredAtPrecision: "unknown", ageDays: null, ageLabel: null, locationText: null, childPersonId: null, participantPersonIds: [], participants: [], sourceNotes: [], assets: [], contributions: [], updatedAt: "2026-09-08T00:00:00.000Z" };
let tree: ReactTestRenderer;
const saved = vi.fn().mockResolvedValue(undefined);
async function press(label: string) {
  const button = tree.root.findAllByType("Pressable" as never).find(node => node.findAllByType("Text" as never).some(text => text.children.join("") === label));
  expect(button, label).toBeDefined();
  await act(async () => button!.props.onPress());
}
beforeEach(async () => { mocks.patch.mockReset(); mocks.share.mockReset(); saved.mockClear(); mocks.online = true; await act(async () => { tree = create(createElement(MemoryEditor, { memory, onSaved: saved })); }); });
afterEach(async () => { await act(async () => tree.unmount()); });
it("pending saves lock the editor so a later input cannot be discarded by the earlier response", async () => {
  let finish!: (memory: MobileMemory) => void;
  mocks.patch.mockReturnValue(new Promise<MobileMemory>(resolve => { finish = resolve; }));
  await press("修改这件事");
  await act(async () => tree.root.findByProps({ accessibilityLabel: "记忆正文" }).props.onChangeText("已发出的正文"));
  await press("保存记忆修改");
  expect(mocks.patch.mock.calls[0]![2]).toMatchObject({ bodyText: "已发出的正文", expectedRevision: 3 });
  expect(tree.root.findByProps({ accessibilityLabel: "记忆正文" }).props.editable).toBe(false);
  expect(tree.root.findByProps({ accessibilityLabel: "家人B" }).props.disabled).toBe(true);
  await act(async () => finish({ ...memory, bodyText: "已发出的正文", titleRevision: 4 }));
  expect(saved).toHaveBeenCalledOnce();
});
it("conflict and offline failures retain actual native editing input", async () => {
  mocks.patch.mockRejectedValue(new ApiError("changed", 409));
  await press("修改这件事");
  await act(async () => tree.root.findByProps({ accessibilityLabel: "记忆正文" }).props.onChangeText("冲突后不能丢的输入"));
  await press("保存记忆修改");
  expect(tree.root.findByProps({ accessibilityLabel: "记忆正文" }).props.value).toBe("冲突后不能丢的输入");
  expect(JSON.stringify(tree.toJSON())).toContain("输入和选择已保留");
  mocks.online = false;
  await act(async () => tree.update(createElement(MemoryEditor, { memory, onSaved: saved })));
  await press("保存记忆修改");
  expect(mocks.patch).toHaveBeenCalledOnce();
  expect(tree.root.findByProps({ accessibilityLabel: "记忆正文" }).props.value).toBe("冲突后不能丢的输入");
});

it("a conflict refreshes the source while retaining input; reopening uses the refreshed revision", async () => {
  mocks.patch.mockRejectedValueOnce(new ApiError("changed", 409)).mockResolvedValueOnce({ ...memory, titleRevision: 5 });
  saved.mockImplementationOnce(async () => { tree.update(createElement(MemoryEditor, { memory: { ...memory, bodyText: "另一端正文", titleRevision: 4 }, onSaved: saved })); });
  await press("修改这件事");
  await act(async () => tree.root.findByProps({ accessibilityLabel: "记忆正文" }).props.onChangeText("冲突草稿"));
  await press("保存记忆修改");
  expect(tree.root.findByProps({ accessibilityLabel: "记忆正文" }).props.value).toBe("冲突草稿");
  await press("取消编辑"); await press("修改这件事");
  expect(tree.root.findByProps({ accessibilityLabel: "记忆正文" }).props.value).toBe("另一端正文");
  await press("保存记忆修改");
  expect(mocks.patch.mock.calls[1]![2]).toMatchObject({ expectedRevision: 4, bodyText: "另一端正文" });
});
