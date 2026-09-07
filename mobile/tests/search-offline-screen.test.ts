/// <reference types="node" />
import { createElement } from "react";
import { createHash } from "node:crypto";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * FIND-2 离线搜索 UI：断网时自动「仅搜索这台设备已保存的内容」并明确
 * 告知范围；结果只打开设备能打开的内容；只剩索引的记忆如实提示需联网。
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
    // FlatList mock：渲染 renderItem 的每一行，便于断言结果内容与可点按性。
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
    Pressable: "Pressable",
    ScrollView: "ScrollView",
    StyleSheet: { create: (v: unknown) => v },
    Text: "Text",
    TextInput: "TextInput",
    View: "View",
  };
});
vi.mock("@react-navigation/native", () => ({ useNavigation: () => mocks.navigation }));
vi.mock("@react-navigation/native-stack", () => ({}));
vi.mock("../src/state/AppContext", () => ({ useApp: () => mocks.app }));
vi.mock("../src/api/client", () => ({ searchMobile: mocks.searchMobile }));

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
    `INSERT INTO timeline_event (id, title, occurred_at, occurred_at_precision, location_text, child_person_id, age_days, age_label, updated_at, asset_count, participant_names_json, cover_json, local_cover_uri, seen_snapshot)
     VALUES ('memory-idx', '海边的一天', '2026-08-01T00:00:00.000Z', 'exact', NULL, NULL, NULL, NULL, '2026-08-01T00:00:00.000Z', 0, '[]', '{}', NULL, 1)`,
  );
  await db.runAsync(
    `INSERT INTO local_capture (id, kind, title, occurred_at, local_uri, media_type, inbox_item_id, memory_event_id, sync_state, payload_json, title_source, title_revision)
     VALUES ('capture-sea', 'text_capture', '海边随笔', '2026-08-02T00:00:00.000Z', NULL, NULL, NULL, NULL, 'pending', '{"text":"海风很大，孩子追着浪跑。"}', 'legacy_unknown', 0)`,
  );
  void scope;
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

async function renderAndSearch() {
  await act(async () => { tree = create(createElement(SearchScreen, { navigation: mocks.navigation, route: { params: {} } } as never)); });
  const input = tree!.root.find((node) => node.props.accessibilityLabel === "搜索家庭记忆");
  await act(async () => input.props.onChangeText("海边"));
  const button = tree!.root.find((node) => node.props.accessibilityLabel === "开始搜索");
  await act(async () => { button.props.onPress(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

it("断网时不请求服务器：自动仅搜本机内容并明确告知范围", async () => {
  await renderAndSearch();
  expect(mocks.searchMobile).not.toHaveBeenCalled();
  expect(allText()).toContain("当前离线，仅搜索这台设备已保存的内容。");
  expect(allText()).toContain("海边的一天");
  expect(allText()).toContain("海边随笔");
});

it("只剩索引的记忆离线点开时如实提示，本机记录可以打开", async () => {
  await renderAndSearch();
  const memoryRow = tree!.root.find((node) => node.props.accessibilityLabel === "打开记忆：海边的一天");
  await act(async () => memoryRow.props.onPress());
  expect(allText()).toContain("这份内容目前只保留了索引，需要联网重新获取。");
  expect(mocks.navigation.navigate).not.toHaveBeenCalled();

  const localRow = tree!.root.find((node) => node.props.accessibilityLabel === "打开本机记录：海边随笔");
  await act(async () => localRow.props.onPress());
  expect(mocks.navigation.navigate).toHaveBeenCalledWith("LocalCapture", { captureId: "capture-sea" });
});

it("联网时优先完整服务器搜索", async () => {
  mocks.app.online = true;
  mocks.searchMobile.mockResolvedValue({ items: [{ type: "memory", id: "m-9", eventId: "m-9", title: "服务器结果", snippet: "来自完整档案" }], nextCursor: null });
  await renderAndSearch();
  expect(mocks.searchMobile).toHaveBeenCalledWith(mocks.app.credentials, "海边", null);
  expect(allText()).toContain("服务器结果");
  expect(allText()).not.toContain("仅搜索这台设备");
});
