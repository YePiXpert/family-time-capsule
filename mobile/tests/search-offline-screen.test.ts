/// <reference types="node" />
import { createElement } from "react";
import { createHash } from "node:crypto";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * FIND-2 搜索 UI（正式 1.0）：
 * - 断网时自动「仅搜索这台设备已保存的内容」并明确告知范围；
 * - 请求代际：乱序返回只保留新查询（T01）；旧请求的 finally 不关新 loading；
 * - 错误分类：网络不可达才自动降级；401/429 明确提示并提供「只搜本机」入口；
 * - 筛选（人物/媒体类型）在离线结果上生效。
 */

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const mocks = vi.hoisted(() => ({
  navigation: { navigate: vi.fn() },
  searchMobile: vi.fn(),
  app: {
    credentials: { serverUrl: "https://family-a.example.test", token: "token-a", instanceId: "instance-a" },
    family: { id: "family-a", name: "我们一家", timezone: "Asia/Shanghai" },
    viewer: { id: "user-a", role: "admin" },
    online: false as boolean | null,
    people: [] as { id: string; displayName: string }[],
  },
}));

vi.mock("expo-sqlite", async () => await import("../../tests/mocks/expo-sqlite"));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: async (_algorithm: string, value: string) => hash(value),
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/tmp/fictional/",
  makeDirectoryAsync: async () => true,
  deleteAsync: async () => true,
  readDirectoryAsync: async () => [] as string[],
  getInfoAsync: async () => ({ exists: false, isDirectory: false }),
  copyAsync: async () => true,
  moveAsync: async () => true,
  writeAsStringAsync: async () => true,
  readAsStringAsync: async () => "",
  createDownloadResumable: () => ({ downloadAsync: async () => null }),
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(public uri: string) {}
    async exists() { return false; }
    async create() {}
    async delete() {}
    async text() { return ""; }
    async write() {}
  },
}));
vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  return {
    ActivityIndicator: "ActivityIndicator",
    // FlatList/ScrollView mock：渲染 renderItem 的每一行，便于断言结果内容与可点按性。
    FlatList: (props: {
      data?: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactElement;
      ListEmptyComponent?: React.ReactElement | null;
      ListFooterComponent?: React.ReactElement | null;
    }) =>
      createElement(
        "View",
        null,
        ...(props.data ?? []).map((item, index) =>
          createElement("View", { key: `row-${String(index)}` }, props.renderItem({ item, index })),
        ),
        (props.data ?? []).length === 0 && props.ListEmptyComponent
          ? [createElement("View", { key: "empty" }, props.ListEmptyComponent)]
          : [],
        props.ListFooterComponent ? [createElement("View", { key: "footer" }, props.ListFooterComponent)] : [],
      ),
    ScrollView: (props: { children?: React.ReactNode }) => createElement("View", null, props.children),
    Pressable: "Pressable",
    StyleSheet: { create: (v: unknown) => v },
    Text: "Text",
    TextInput: "TextInput",
    View: "View",
  };
});
vi.mock("@react-navigation/native", () => ({ useNavigation: () => mocks.navigation }));
vi.mock("@react-navigation/native-stack", () => ({}));
vi.mock("../src/state/AppContext", () => { const useApp = () => mocks.app; return { useApp, useAppData: useApp, useAppActions: useApp, useSyncStatus: useApp }; });
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
  },
  searchMobile: mocks.searchMobile,
}));

const { initializeLocalStore, getDatabase } = await import("../src/storage/database");
const { memoryCacheScope } = await import("../src/memories/cache-scope");
const { SearchScreen } = await import("../src/screens/SearchScreen");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// 预热离线搜索会动态加载的阅读缓存模块：vitest 的模块变换是宏任务，
// 不预热会让 act 等不到搜索链路完成。
await import("../src/reading/native");

let tree: ReactTestRenderer | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.app.online = false;
  mocks.app.people = [];
  await initializeLocalStore();
  const db = await getDatabase();
  await db.execAsync(`CREATE TABLE IF NOT EXISTS reading_download(key TEXT PRIMARY KEY NOT NULL,scope TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,state TEXT NOT NULL,reserved_bytes INTEGER NOT NULL,stored_bytes INTEGER NOT NULL,error TEXT,updated_at INTEGER NOT NULL,manifest_json TEXT NOT NULL,completed_json TEXT NOT NULL,progress_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS reading_binding(credential_hash TEXT PRIMARY KEY NOT NULL,scope_json TEXT NOT NULL);`);
  for (const table of ["timeline_event", "memory_detail", "local_capture", "people", "reading_download", "reading_binding"]) {
    await db.runAsync(`DELETE FROM ${table}`);
  }
  const scope = memoryCacheScope(mocks.app.credentials, mocks.app.viewer.id, mocks.app.family.id)!;
  // 一条只有时间轴索引（无详情缓存）的记忆 + 一条本机记录
  await db.runAsync(
    `INSERT INTO timeline_event (id, scope, title, occurred_at, occurred_at_precision, location_text, child_person_id, age_days, age_label, updated_at, asset_count, participant_names_json, cover_json, local_cover_uri, seen_snapshot)
     VALUES ('memory-idx', ?, '海边的一天', '2026-08-01T00:00:00.000Z', 'exact', NULL, NULL, NULL, NULL, '2026-08-01T00:00:00.000Z', 0, '[]', '{}', NULL, 1)`,
    scope,
  );
  await db.runAsync(
    `INSERT INTO local_capture (id, kind, title, occurred_at, local_uri, media_type, inbox_item_id, memory_event_id, sync_state, payload_json, title_source, title_revision)
     VALUES ('capture-sea', 'text_capture', '海边随笔', '2026-08-02T00:00:00.000Z', NULL, NULL, NULL, NULL, 'pending', '{"text":"海风很大，孩子追着浪跑。"}', 'legacy_unknown', 0)`,
  );
});
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
});

const allText = () =>
  tree!.root
    .findAll((node) => String(node.type) === "Text")
    .map((node) => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join("") : String(children ?? "");
    })
    .join("\n");

async function render() {
  await act(async () => { tree = create(createElement(SearchScreen, { navigation: mocks.navigation, route: { params: {} } } as never)); });
}

async function submit(query: string) {
  const input = tree!.root.find((node) => node.props.accessibilityLabel === "搜索家庭记忆");
  await act(async () => input.props.onChangeText(query));
  const button = tree!.root.find((node) => node.props.accessibilityLabel === "开始搜索");
  await act(async () => { button.props.onPress(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

it("断网时不请求服务器：自动仅搜本机内容并明确告知范围", async () => {
  await render();
  await submit("海边");
  expect(mocks.searchMobile).not.toHaveBeenCalled();
  expect(allText()).toContain("当前离线，仅搜索这台设备已保存的内容。");
  expect(allText()).toContain("海边的一天");
  expect(allText()).toContain("海边随笔");
});

it("只剩索引的记忆离线点开时如实提示，本机记录可以打开", async () => {
  await render();
  await submit("海边");
  const memoryRow = tree!.root.find((node) => node.props.accessibilityLabel === "打开记忆：海边的一天");
  await act(async () => memoryRow.props.onPress());
  expect(allText()).toContain("这份内容目前只保留了索引，需要联网重新获取。");
  expect(mocks.navigation.navigate).not.toHaveBeenCalled();

  const localRow = tree!.root.find((node) => node.props.accessibilityLabel === "打开本机记录：海边随笔");
  await act(async () => localRow.props.onPress());
  expect(mocks.navigation.navigate).toHaveBeenCalledWith("LocalCapture", { captureId: "capture-sea" });
});

it("联网时优先完整服务器搜索，筛选参数随请求传递", async () => {
  mocks.app.online = true;
  mocks.app.people = [{ id: "person-1", displayName: "外婆" }];
  mocks.searchMobile.mockResolvedValue({ items: [{ type: "memory", id: "m-9", eventId: "m-9", title: "服务器结果", snippet: "来自完整档案" }], nextCursor: null });
  await render();
  // 选择人物筛选 + 媒体类型
  const personChip = tree!.root.find((node) => node.props.accessibilityLabel === "筛选人物：外婆");
  await act(async () => personChip.props.onPress());
  const videoChip = tree!.root.find((node) => node.props.accessibilityLabel === "筛选类型：视频");
  await act(async () => videoChip.props.onPress());
  await submit("海边");
  expect(mocks.searchMobile).toHaveBeenCalledWith(mocks.app.credentials, "海边", null, { personId: "person-1", dateFrom: undefined, dateTo: undefined, mediaType: "video" });
  expect(allText()).toContain("服务器结果");
  expect(allText()).not.toContain("仅搜索这台设备");
});

it("T01 连续两次搜索乱序返回，只保留新查询", async () => {
  mocks.app.online = true;
  let resolveFirst!: (value: unknown) => void;
  mocks.searchMobile.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
  mocks.searchMobile.mockResolvedValueOnce({
    items: [{ type: "memory", id: "m-2", eventId: "m-2", title: "新查询的结果", snippet: "Q2" }],
    nextCursor: null,
  });
  await render();
  await submit("慢查询");
  await submit("快查询");
  await act(async () => { resolveFirst({ items: [{ type: "memory", id: "m-1", eventId: "m-1", title: "旧查询的结果", snippet: "Q1" }], nextCursor: null }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(allText()).toContain("新查询的结果");
  expect(allText()).not.toContain("旧查询的结果");
});

it("401 不降级伪装断网：显示重新登录指引，并可显式只搜本机", async () => {
  mocks.app.online = true;
  const { ApiError } = await import("../src/api/client");
  mocks.searchMobile.mockRejectedValue(new ApiError("登录已过期", 401));
  await render();
  await submit("海边");
  expect(allText()).toContain("登录已过期，请重新登录后再搜索家庭档案。");
  // 不自动显示本机结果（避免误以为已搜索家庭档案）
  expect(allText()).not.toContain("海边的一天");
  const deviceOnly = tree!.root.find((node) => node.props.accessibilityLabel === "只搜索这台设备已保存的内容");
  await act(async () => deviceOnly.props.onPress());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(allText()).toContain("以下结果只来自这台设备已保存的内容。");
  expect(allText()).toContain("海边的一天");
});

it("429 明确限流提示，不自动降级；网络不可达（status 0）自动降级", async () => {
  mocks.app.online = true;
  const { ApiError } = await import("../src/api/client");
  mocks.searchMobile.mockRejectedValueOnce(new ApiError("请求过于频繁", 429));
  await render();
  await submit("海边");
  expect(allText()).toContain("搜索请求过于频繁，请稍后再试。");
  expect(allText()).not.toContain("海边的一天");

  mocks.searchMobile.mockRejectedValueOnce(new ApiError("无法连接家庭服务器", 0));
  await submit("海风");
  expect(allText()).toContain("无法连接服务器，已改为仅搜索这台设备已保存的内容。");
  expect(allText()).toContain("海边随笔");
});

it("筛选变化后不再提供「加载更多」，避免新旧筛选混页", async () => {
  mocks.app.online = true;
  mocks.searchMobile.mockResolvedValue({
    items: [{ type: "memory", id: "m-1", eventId: "m-1", title: "第一页", snippet: "s" }],
    nextCursor: "cursor-1",
  });
  await render();
  await submit("海边");
  expect(tree!.root.findAll((node) => node.props.accessibilityLabel === "加载更多")).toHaveLength(1);
  const videoChip = tree!.root.find((node) => node.props.accessibilityLabel === "筛选类型：视频");
  await act(async () => videoChip.props.onPress());
  expect(tree!.root.findAll((node) => node.props.accessibilityLabel === "加载更多")).toHaveLength(0);
  expect(allText()).toContain("筛选已变化，点击「搜索」查看新结果。");
  // 重新搜索后恢复分页，且请求携带新筛选
  mocks.searchMobile.mockClear();
  mocks.searchMobile.mockResolvedValue({ items: [{ type: "memory", id: "m-2", eventId: "m-2", title: "视频结果", snippet: "s" }], nextCursor: null });
  await submit("海边");
  expect(mocks.searchMobile).toHaveBeenCalledWith(mocks.app.credentials, "海边", null, { personId: undefined, dateFrom: undefined, dateTo: undefined, mediaType: "video" });
  expect(allText()).toContain("视频结果");
});

it("离线人物筛选只保留该人物参与的本机可见记忆", async () => {
  mocks.app.people = [{ id: "person-1", displayName: "外婆" }];
  const db = await getDatabase();
  const scope = memoryCacheScope(mocks.app.credentials, mocks.app.viewer.id, mocks.app.family.id)!;
  await db.runAsync(
    `INSERT INTO timeline_event (id, scope, title, occurred_at, occurred_at_precision, location_text, child_person_id, age_days, age_label, updated_at, asset_count, participant_names_json, cover_json, local_cover_uri, seen_snapshot)
     VALUES ('memory-waipo', ?, '外婆的花园', '2026-07-01T00:00:00.000Z', 'exact', NULL, NULL, NULL, NULL, '2026-07-01T00:00:00.000Z', 0, ?, '{}', NULL, 1)`,
    scope, JSON.stringify(["外婆"]),
  );
  await render();
  const personChip = tree!.root.find((node) => node.props.accessibilityLabel === "筛选人物：外婆");
  await act(async () => personChip.props.onPress());
  await submit("的");
  expect(allText()).toContain("外婆的花园");
  expect(allText()).not.toContain("海边的一天");
});
