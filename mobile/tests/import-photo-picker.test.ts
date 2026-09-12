import { createElement, useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { createPhotoSelection, type ImportPickItem, type ImportPhotoSelection } from "../src/imports/photo-selection";
const mocks = vi.hoisted(() => ({ changes: vi.fn(), opens: vi.fn(), sequence: 0 }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `manual-${++mocks.sequence}` }));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "Icon" }));
vi.mock("../src/components/typography", () => ({ Text: "Text" }));
vi.mock("react-native", () => ({
  Image: "Image", Pressable: "Pressable", Text: "Text", View: "View", ScrollView: "ScrollView",
  FlatList: (props: { data: unknown[]; ListHeaderComponent?: ReactNode; ListFooterComponent?: ReactNode; renderItem: (args: { item: unknown; index: number }) => ReactNode }) => createElement("FlatList", props, props.ListHeaderComponent, props.data.slice(0, 30).map((item, index) => createElement("Cell", { key: index }, props.renderItem({ item, index }))), props.ListFooterComponent),
  StyleSheet: { create: (style: unknown) => style, absoluteFill: {} },
}));
const { ImportPhotoPicker } = await import("../src/components/ImportPhotoPicker");
const credentials = { serverUrl: "https://family.example", token: "fixture-only" };
const items: ImportPickItem[] = [
  { id: "a", title: "a.jpg", type: "image", localUri: "file:///a.jpg", capturedAt: "2026-09-12T12:00:00Z" },
  { id: "b", title: "b.jpg", type: "image", localUri: "file:///b.jpg", capturedAt: "2026-09-12T12:00:05Z" },
  { id: "c", title: "c.jpg", type: "image", localUri: "file:///c.jpg", capturedAt: "2026-09-12T12:00:40Z" },
  { id: "video", title: "video.mov", type: "video" }, { id: "audio", title: "voice.m4a", type: "audio" }, { id: "text", title: "原文", type: "text" },
];
function Harness({ values = items, disabled = false, lockedIds = [] }: { values?: ImportPickItem[]; disabled?: boolean; lockedIds?: string[] }) {
  const [selection, setSelection] = useState(() => createPhotoSelection(values));
  return createElement(ImportPhotoPicker, { items: values, selection, disabled, lockedIds, credentials, onOpen: mocks.opens, onSelectionChange: next => { mocks.changes(next); setSelection(next); } });
}
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; vi.clearAllMocks(); });
async function render(props: Parameters<typeof Harness>[0] = {}) { await act(() => { tree = create(createElement(Harness, props)); }); }
function button(label: string, within: ReactTestInstance = tree!.root) { return within.findAll(node => String(node.type) === "Pressable" && (node.props.accessibilityLabel === label || node.findAllByType("Text" as never).some(text => text.children.join("") === label)))[0]!; }
async function press(label: string, within?: ReactTestInstance) { const node = button(label, within); expect(node, label).toBeDefined(); expect(node.props.disabled).toBeFalsy(); await act(() => node.props.onPress()); }
function row(title: string) { return button(`选中 ${title}`).parent!.parent!; }
function selection(): ImportPhotoSelection { return tree!.root.findByType(ImportPhotoPicker).props.selection; }
function assertComplete(value: ImportPhotoSelection) { expect(value.groups.flatMap(group => group.ids).sort()).toEqual(items.map(item => item.id).sort()); }

it("chooses a group representative and cover, keeps non-photos selected, and opens original media without changing selection", async () => {
  await render({ lockedIds: ["text"] }); await press("全部展开");
  await press("设为代表图", row("b.jpg")); await press("设为封面", row("b.jpg"));
  await press("仅选代表图");
  expect(selection().selectedIds).toEqual(["b", "c", "video", "audio", "text"]);
  expect(selection().coverId).toBe("b");
  expect(selection().groups[0]?.representativeId).toBe("b");
  expect(button("选中 原文").props.disabled).toBe(true);
  const changed = mocks.changes.mock.calls.length;
  await press("查看原件：b.jpg");
  expect(mocks.opens).toHaveBeenCalledWith(items[1]); expect(mocks.changes).toHaveBeenCalledTimes(changed);
  await press("选中 b.jpg"); expect(selection().coverId).toBeNull();
  await press("全选"); expect(selection().selectedIds).toEqual(items.map(item => item.id));
  assertComplete(selection());
});

it("merges selected photos and splits them again without changing non-photo groups, selected IDs or cover", async () => {
  await render(); const initial = selection();
  await press("将已选照片合为一组");
  const merged = selection();
  expect(merged.groups.find(group => group.reason === "manual")?.ids).toEqual(["a", "b", "c"]);
  expect(merged.groups.find(group => group.ids.includes("video"))?.ids).toEqual(["video", "audio", "text"]);
  expect(merged.selectedIds).toEqual(initial.selectedIds); expect(merged.coverId).toBe(initial.coverId); assertComplete(merged);
  await press("拆开这组照片");
  expect(selection().groups.filter(group => group.reason === "manual").map(group => group.ids)).toEqual([["a"], ["b"], ["c"]]);
  expect(selection().selectedIds).toEqual(initial.selectedIds); expect(selection().coverId).toBe(initial.coverId); assertComplete(selection());
});

it("leaves readonly selections immutable while allowing a user to expand and inspect every item", async () => {
  await render({ disabled: true });
  expect(button("全选").props.disabled).toBe(true); expect(button("仅选代表图").props.disabled).toBe(true);
  await press("全部展开");
  expect(tree!.root.findAll(node => String(node.type) === "Pressable" && node.props.accessibilityRole === "checkbox")).toHaveLength(items.length);
  expect(button("选中 a.jpg").props.disabled).toBe(true);
  await press("查看原件：a.jpg"); expect(mocks.opens).toHaveBeenCalledWith(items[0]); expect(mocks.changes).not.toHaveBeenCalled();
});

it("keeps a large expanded import in a single virtualized list rather than nesting full media rows in a ScrollView", async () => {
  await render({ values: Array.from({ length: 500 }, (_, index) => ({ id: `photo-${index}`, title: `photo-${index}`, type: "image" as const })) });
  await press("全部展开");
  const list = tree!.root.findByType("FlatList" as never);
  expect(list.props.data).toHaveLength(501);
  expect(list.props.data.filter((entry: { kind: string }) => entry.kind === "item")).toHaveLength(500);
  expect(list.props.initialNumToRender).toBeLessThan(500); expect(list.props.windowSize).toBeGreaterThan(0);
  expect(tree!.root.findAllByType("FlatList" as never)).toHaveLength(1); expect(tree!.root.findAllByType("ScrollView" as never)).toHaveLength(0);
});

it("only sends thumbnail credentials to this server, and a failed thumbnail keeps the item selectable", async () => {
  const values: ImportPickItem[] = [{ id: "safe", title: "safe", type: "image", thumbnailUri: "/api/media/safe" }, { id: "foreign", title: "foreign", type: "image", thumbnailUri: "https://elsewhere.example/photo" }, { id: "local", title: "local", type: "image", localUri: "file:///local.jpg" }];
  await render({ values }); await press("全部展开");
  const images = tree!.root.findAllByType("Image" as never);
  expect(images.some(image => image.props.source.uri.includes("elsewhere.example"))).toBe(false);
  expect(images.find(image => image.props.source.uri === "https://family.example/api/media/safe")?.props.source.headers).toEqual({ Authorization: "Bearer fixture-only" });
  const local = images.find(image => image.props.source.uri === "file:///local.jpg")!;
  expect(local.props.source.headers).toBeUndefined(); const frame = local.parent!; const style = frame.props.style;
  await act(() => local.props.onError());
  expect(frame.props.style).toEqual(style);
  await press("选中 local"); expect(selection().selectedIds).not.toContain("local");
});
