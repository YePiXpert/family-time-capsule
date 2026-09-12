import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalTimelineEvent } from "../src/types";

const mocks = vi.hoisted(() => ({
  app: { credentials: null as unknown, events: [] as LocalTimelineEvent[], family: { timezone: "UTC" }, home: null, outbox: [], people: [], viewer: null, syncing: false },
  status: { syncing: false, message: null as string | null },
  navigation: { navigate: vi.fn() }, sync: vi.fn(), reload: vi.fn(), dismiss: vi.fn(),
  cardRenders: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Image: "Image", Pressable: "Pressable", ScrollView: "ScrollView", RefreshControl: "RefreshControl",
  FlatList: (props: { ListHeaderComponent: ReactNode; data: LocalTimelineEvent[]; renderItem: (args: { item: LocalTimelineEvent; index: number }) => ReactNode }) => createElement("FlatList", props, props.ListHeaderComponent, props.data.map((item, index) => createElement("Cell", { key: item.id }, props.renderItem({ item, index })))),
  StyleSheet: { create: (style: unknown) => style, absoluteFill: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }, hairlineWidth: 1 },
  Platform: { OS: "ios" },
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 48, bottom: 34 }) }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => mocks.navigation }));
vi.mock("../src/components/typography", () => ({ Text: "Text" }));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "Icon" }));
vi.mock("../src/components/JournalArtwork", () => ({ JournalArtwork: "Artwork" }));
vi.mock("../src/components/SwipeActions", () => ({ SwipeActions: ({ children }: { children: ReactNode }) => children }));
vi.mock("../src/components/ContextMenu", () => {
  const openMenu = vi.fn();
  return { useContextMenu: () => ({ openMenu, menuElement: null }) };
});
vi.mock("../src/screens/PendingScreen", () => ({ usePendingImports: () => [] }));
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({ ...mocks.app, ...mocks.status, runSync: mocks.sync, reloadLocal: mocks.reload }),
  useAppData: () => mocks.app,
  useAppActions: () => ({ runSync: mocks.sync, reloadLocal: mocks.reload, dismissMessage: mocks.dismiss }),
  useSyncStatus: () => mocks.status,
}));
vi.mock("../src/components/TimelineCard", async original => {
  const actual = await original<typeof import("../src/components/TimelineCard")>();
  return { TimelineCard: (props: Parameters<typeof actual.TimelineCard>[0]) => { mocks.cardRenders(props.item.id); return createElement(actual.TimelineCard, props); } };
});
const { TimelineCard } = await import("../src/components/TimelineCard");
const { TimelineScreen } = await import("../src/screens/TimelineScreen");
const { SyncBanner } = await import("../src/components/SyncBanner");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
const event = (id = "memory-a"): LocalTimelineEvent => ({ id, title: "今天的照片", occurredAt: "2026-09-01T12:00:00Z", occurredAtPrecision: "exact", locationText: null, childPersonId: null, ageDays: null, ageLabel: null, updatedAt: "2026-09-01T12:00:00Z", assetCount: 1, participantNames: [], captureIds: [], cover: { assetId: "cover", mediaAssetId: "photo", type: "image", mimeType: "image/jpeg", path: "/cover" }, localCoverUri: null, source: "server", syncState: null });
const flatten = (style: unknown): Record<string, unknown> => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style as Record<string, unknown>;
beforeEach(() => { vi.clearAllMocks(); mocks.app.events = []; mocks.status.syncing = false; mocks.status.message = null; mocks.app.credentials = null; });
afterEach(async () => { if (tree) await act(() => tree!.unmount()); tree = undefined; });

it("reserves the same cover frame before loading, after loading and after failure", async () => {
  const item = event();
  const press = vi.fn();
  await act(() => { tree = create(createElement(TimelineCard, { item, onPress: press })); });
  const frame = () => tree!.root.findByProps({ testID: "timeline-card-media-memory-a" });
  const pending = frame();
  const geometry = flatten(pending.props.style);
  expect(geometry).toMatchObject({ width: "100%", aspectRatio: 4 / 3 });
  const loaded = { ...item, localCoverUri: "file:///photo.jpg" };
  await act(() => tree!.update(createElement(TimelineCard, { item: loaded, onPress: press })));
  expect(frame()).toBe(pending);
  expect(flatten(frame().props.style)).toEqual(geometry);
  await act(() => tree!.root.findByType("Image" as never).props.onError());
  expect(frame()).toBe(pending);
  expect(flatten(frame().props.style)).toEqual(geometry);
  expect(tree!.root.findAllByType("Image" as never)).toHaveLength(0);
  await act(() => tree!.root.findByType("Pressable" as never).props.onPress());
  expect(press).toHaveBeenCalledOnce();
});

it("keeps records without a cover compact and does not scale a pressed card", async () => {
  await act(() => { tree = create(createElement(TimelineCard, { item: { ...event(), cover: null }, onPress: vi.fn() })); });
  expect(tree!.root.findAllByProps({ testID: "timeline-card-media-memory-a" })).toHaveLength(0);
  const card = tree!.root.findByType("Pressable" as never);
  expect(flatten(card.props.style({ pressed: true })).transform).toBeUndefined();
  expect(JSON.stringify(tree!.toJSON())).toContain("份素材");
});

it("only user refresh starts the pull indicator and preserves unchanged list data and rows", async () => {
  mocks.app.events = Array.from({ length: 500 }, (_, index) => event(`memory-${index}`));
  mocks.app.credentials = { serverUrl: "https://fixture.invalid" };
  let finish: (() => void) | undefined;
  mocks.sync.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(() => { tree = create(createElement(TimelineScreen)); });
  const list = () => tree!.root.findByType("FlatList" as never);
  const data = list().props.data;
  const rows = mocks.cardRenders.mock.calls.length;
  expect(list().props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 1 });
  expect(list().props.onScroll).toBeUndefined();
  expect(flatten(tree!.root.find(node => String(node.type) === "View" && node.props.testID === "timeline-heading").props.style).transform).toBeUndefined();
  mocks.status.syncing = true;
  await act(() => tree!.update(createElement(TimelineScreen)));
  expect(list().props.refreshControl.props.refreshing).toBe(false);
  expect(list().props.data).toBe(data);
  expect(mocks.cardRenders).toHaveBeenCalledTimes(rows);
  await act(async () => list().props.refreshControl.props.onRefresh());
  expect(list().props.refreshControl.props.refreshing).toBe(true);
  await act(async () => finish!());
  expect(list().props.refreshControl.props.refreshing).toBe(false);
  expect(mocks.status.syncing).toBe(true);
  expect(list().props.data).toBe(data);
});

it("shows and dismisses the sync notice in an absolute overlay", async () => {
  await act(() => { tree = create(createElement(SyncBanner)); });
  expect(tree!.toJSON()).toBeNull();
  mocks.status.message = "同步完成";
  await act(() => tree!.update(createElement(SyncBanner)));
  const container = tree!.root.findByType("View" as never);
  expect(flatten(container.props.style)).toMatchObject({ position: "absolute" });
  expect(flatten(container.props.style).top).toBeGreaterThanOrEqual(48 + 56);
  expect(container.props.pointerEvents).toBe("box-none");
  await act(() => tree!.root.findByProps({ testID: "sync-banner" }).props.onPress());
  expect(mocks.dismiss).toHaveBeenCalledOnce();
});
