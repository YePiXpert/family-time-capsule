import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryEditScope } from "../src/memories/edit-model";
import type { BookMaterials } from "../src/api/client";

const mocks = vi.hoisted(() => ({
  materials: vi.fn(), create: vi.fn(), created: vi.fn(), cancel: vi.fn(),
  context: { credentials: { serverUrl: "https://fictional.example.test", token: "fictional-token", instanceId: "fixture" }, userId: "owner", viewer: { id: "owner" }, family: { id: "family" } },
}));
vi.mock("react-native", () => ({ Image: "Image", Pressable: "Pressable", ScrollView: "ScrollView", View: "View", Text: "Text", TextInput: "TextInput", StyleSheet: { create: (value: unknown) => value } }));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect", Circle: "Circle" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]) }));
vi.mock("../src/state/AppContext", () => ({ useAppData: () => mocks.context }));
vi.mock("../src/api/client", () => ({ fetchBookMaterials: mocks.materials, requestMobileJson: mocks.create }));
const { WorkCreator } = await import("../src/screens/WorkCreator");
const { BookCreateScreen } = await import("../src/screens/BookCreateScreen");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const initialCredentials = { ...mocks.context.credentials };
beforeEach(() => { mocks.context.credentials = { ...initialCredentials }; mocks.context.userId = "owner"; mocks.context.viewer.id = "owner"; mocks.context.family.id = "family"; });
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; vi.clearAllMocks(); });
const row = (id: string): BookMaterials["entries"][number] => ({ id, kind: "memory", title: `故事 ${id}`, occurredAt: "2026-09-01T08:00:00Z", occurredAtPrecision: "month", images: [{ id: `photo-${id}`, filename: "family.jpg", mimeType: "image/jpeg", type: "image", width: 800, height: 600, bytes: 123, previewAssetId: null }] });
function control(label: string) {
  return tree!.root.findAll(n => String(n.type) === "Pressable" && (n.props.accessibilityLabel === label || n.findAll(child => String(child.type) === "Text" && child.props.children === label).length > 0))[0]!;
}
async function press(label: string) { const node = control(label); expect(node).toBeTruthy(); expect(node.props.disabled).not.toBe(true); await act(async () => node.props.onPress()); }
async function mount(ids: string[]) { await act(async () => { tree = create(createElement(WorkCreator, { kind: "book", initialMemoryIds: ids, onCreated: mocks.created, onCancel: mocks.cancel })); }); }

it("carries exact off-page selections into a personal book and keeps them when changing style", async () => {
  mocks.materials.mockImplementation(async (_credentials, _kind, _audience, _cursor, _month, ids?: string[]) => ({ entries: ids ? ids.map(row) : [row("unselected-first-page")], nextCursor: ids ? null : "next" }));
  mocks.create.mockResolvedValue({ id: "new-book" });
  await mount(["older-story", "private-story"]);
  expect(mocks.materials).toHaveBeenCalledWith(initialCredentials, "memory", "personal", "", "", ["older-story", "private-story"]);
  expect(JSON.stringify(tree!.toJSON())).toContain("故事 older-story");
  expect(JSON.stringify(tree!.toJSON())).toContain("2026年9月");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("2026年9月1日");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("unselected-first-page");
  expect(tree!.root.findAllByType("Image" as never)[0]!.props.source.headers.Authorization).toBe("Bearer fictional-token");
  await press("样式与读者");
  await press("照片册");
  await press("生成预览");
  expect(JSON.parse(mocks.create.mock.lastCall![2].body)).toEqual({ kind: "book", audience: "personal", template: "photos", selection: [{ id: "older-story", kind: "memory" }, { id: "private-story", kind: "memory" }] });
  expect(mocks.created).toHaveBeenCalledWith("new-book");
});

it("retains denied selections explicitly while rechecking a family audience and recovers on returning to personal", async () => {
  mocks.materials.mockImplementation(async (_credentials, _kind, audience, _cursor, _month, ids?: string[]) => ({ entries: (ids ?? []).filter(id => audience === "personal" || id !== "private-story").map(row), nextCursor: null }));
  mocks.create.mockResolvedValue({ id: "personal-book" });
  await mount(["shared-story", "private-story"]);
  await press("样式与读者"); await press("全家可见");
  expect(mocks.materials).toHaveBeenCalledWith(initialCredentials, "memory", "family", "", "", ["shared-story", "private-story"]);
  expect(control("生成预览").props.disabled).toBe(true);
  expect(JSON.stringify(tree!.toJSON())).toContain("目前不能加入全家可见的成长册");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("故事 private-story");
  expect(control("移除第 2 条记忆")).toBeTruthy();
  await press("仅自己"); await press("生成预览");
  expect(JSON.parse(mocks.create.mock.lastCall![2].body).selection).toHaveLength(2);
  expect(JSON.parse(mocks.create.mock.lastCall![2].body).audience).toBe("personal");
});

it("keeps carried IDs on verification failures and creation failures until an explicit retry", async () => {
  mocks.materials.mockImplementation(async (_credentials, _kind, _audience, _cursor, _month, ids?: string[]) => { if (ids) throw new Error("offline"); return { entries: [], nextCursor: null }; });
  await mount(["older-story"]);
  expect(control("生成预览").props.disabled).toBe(true);
  expect(JSON.stringify(tree!.toJSON())).toContain("选择已保留");
  mocks.materials.mockImplementation(async (_credentials, _kind, _audience, _cursor, _month, ids?: string[]) => ({ entries: (ids ?? []).map(row), nextCursor: null }));
  await press("重新核对已选记录");
  mocks.create.mockRejectedValueOnce(new Error("连接暂时中断"));
  await press("生成预览");
  expect(JSON.stringify(tree!.toJSON())).toContain("连接暂时中断");
  expect(JSON.stringify(tree!.toJSON())).toContain("故事 older-story");
  mocks.create.mockResolvedValueOnce({ id: "retry-book" });
  await press("生成预览");
  expect(JSON.parse(mocks.create.mock.lastCall![2].body).selection).toEqual([{ id: "older-story", kind: "memory" }]);
});

it("rejects an old selection route after the account changes and ignores its late results", async () => {
  let finish!: (value: BookMaterials) => void;
  mocks.materials.mockImplementation(() => new Promise<BookMaterials>(resolve => { finish = resolve; }));
  const props = { navigation: { goBack: vi.fn(), replace: vi.fn() }, route: { params: { scope: memoryEditScope(mocks.context.credentials, "owner", "family")!, eventIds: ["old-account-story"] } } } as unknown as Parameters<typeof BookCreateScreen>[0];
  await act(async () => { tree = create(createElement(BookCreateScreen, props)); });
  mocks.context.credentials = { ...initialCredentials, token: "another-token" }; mocks.context.userId = "another-owner";
  await act(async () => tree!.update(createElement(BookCreateScreen, props)));
  await act(async () => finish({ entries: [row("old-account-story")], nextCursor: null }));
  expect(JSON.stringify(tree!.toJSON())).toContain("之前的选择没有带入");
  expect(JSON.stringify(tree!.toJSON())).not.toContain("故事 old-account-story");
  expect(mocks.create).not.toHaveBeenCalled();
});

it("does not read carried selections while the current user and cached viewer disagree", async () => {
  mocks.context.viewer.id = "previous-owner";
  const props = { navigation: { goBack: vi.fn(), replace: vi.fn() }, route: { params: { scope: memoryEditScope(mocks.context.credentials, "owner", "family")!, eventIds: ["stale-account-story"] } } } as unknown as Parameters<typeof BookCreateScreen>[0];
  await act(async () => { tree = create(createElement(BookCreateScreen, props)); });
  expect(JSON.stringify(tree!.toJSON())).toContain("之前的选择没有带入");
  expect(mocks.materials).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
