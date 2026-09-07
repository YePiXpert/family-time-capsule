import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * NAV-11 大字简洁显示（长辈阅读）：
 * 首页只保留四件事、标签更直白、「我的」隐藏高级入口、
 * 随时切回标准显示。权限与数据不因显示模式改变。
 */

const mocks = vi.hoisted(() => ({
  navigation: { navigate: vi.fn() },
  setDisplayMode: vi.fn(),
  app: {
    credentials: { serverUrl: "https://fictional.example.test", token: "t", instanceId: "instance-a" },
    family: { id: "family-a", name: "我们一家", timezone: "Asia/Shanghai" },
    viewer: { role: "admin" },
    people: [],
    events: [],
    outbox: [],
    home: null,
    syncing: false,
    runSync: vi.fn(),
    displayMode: "standard" as string | null,
  },
}));

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  StyleSheet: { create: (v: unknown) => v },
  Text: "Text",
  View: "View",
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => mocks.navigation }));
vi.mock("../src/state/AppContext", () => ({
  useApp: () => ({ ...mocks.app, setDisplayMode: mocks.setDisplayMode }),
}));

const { HomeScreen } = await import("../src/screens/HomeScreen");
const { MoreScreen } = await import("../src/screens/MoreScreen");
const { SimpleHomeScreen } = await import("../src/screens/SimpleHomeScreen");
const { DisplayModeCard } = await import("../src/components/DisplayModeCard");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let tree: ReactTestRenderer | undefined;
const json = () => JSON.stringify(tree!.toJSON());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.app.displayMode = "standard";
  mocks.app.home = null;
});
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
});

function findText(text: string) {
  return tree!.root.findAll((node) => {
    if (String(node.type) !== "Text") return false;
    const children = node.props.children;
    return Array.isArray(children) ? children.join("") === text : children === text;
  });
}
async function pressByLabel(label: string) {
  const button = tree!.root.find((node) => node.props.accessibilityLabel === label);
  await act(async () => button.props.onPress());
}

it("标准显示首页保持快速记录，不出现简洁模式区段", async () => {
  await act(async () => { tree = create(createElement(HomeScreen)); });
  expect(tree!.root.findAll((node) => node.props.testID === "home-capture-text").length).toBeGreaterThan(0);
  expect(findText("最近的照片")).toHaveLength(0);
});

it("简洁首页只保留四件事：照片、声音、故事、我也说几句，空状态如实", async () => {
  mocks.app.displayMode = "simple";
  await act(async () => { tree = create(createElement(HomeScreen)); });
  expect(tree!.root.findAll((node) => node.props.testID === "home-capture-text").length).toBe(0);
  expect(findText("最近的照片")).toHaveLength(1);
  expect(findText("这里还没有最近的照片。")).toHaveLength(1);
  expect(findText("听听家人的声音")).toHaveLength(1);
  expect(findText("还没有家人的录音；说一段话，以后就能在这里听到。")).toHaveLength(1);
  expect(findText("最近的故事")).toHaveLength(1);
  expect(tree!.root.findAll((node) => node.props.testID === "simple-speak").length).toBe(1);
  await pressByLabel("说一段话");
  expect(mocks.navigation.navigate).toHaveBeenCalledWith("Capture", expect.objectContaining({ intent: "audio" }));
});

it("简洁首页的照片与家人声音都来自真实缓存并可打开", async () => {
  mocks.app.displayMode = "simple";
  mocks.app.home = {
    family: { name: "我们一家", timezone: "Asia/Shanghai" },
    child: null,
    capabilities: { canCapture: true },
    inbox: { count: 0, previews: [] },
    recentMemories: [
      { id: "memory-1", title: "公园的下午", occurredAt: "2026-09-01T00:00:00Z", ageLabel: null, coverPath: "/api/media/cover-1" },
    ],
    onThisDay: [],
    voices: [
      { id: "voice-1", memoryEventId: "memory-1", eventTitle: "公园的下午", authorName: "外婆", audioPath: "/api/media/audio-1" },
    ],
    story: null,
    capsule: null,
    prompt: { text: "", recipientLabel: null, pendingCount: 0, isCreatedRequest: false },
    weeklyReview: { key: "w", status: "open", confirmedCount: 0, pendingInboxCount: 0, storyId: null },
    isFirstUse: false,
  } as unknown as typeof mocks.app.home;
  await act(async () => { tree = create(createElement(SimpleHomeScreen)); });
  expect(findText("公园的下午").length).toBeGreaterThan(0);
  expect(findText("外婆 说了段话")).toHaveLength(1);
  await pressByLabel("听外婆在「公园的下午」里的讲述");
  expect(mocks.navigation.navigate).toHaveBeenCalledWith("Memory", { id: "memory-1" });
});

it("简洁「我的」隐藏高级入口并保留显示切换；标准「我的」功能完整", async () => {
  mocks.app.displayMode = "simple";
  await act(async () => { tree = create(createElement(MoreScreen)); });
  expect(json()).not.toContain("仅在 Web 完成的高级操作");
  expect(json()).not.toContain("家庭投递箱");
  expect(findText("显示方式")).toHaveLength(1);

  await act(async () => { tree = create(createElement(DisplayModeCard)); });
  expect(tree!.root.findAll((node) => node.props.testID === "display-simple").length).toBe(1);
  await act(async () => tree!.root.find((node) => node.props.testID === "display-simple").props.onPress());
  expect(mocks.setDisplayMode).toHaveBeenCalledWith("simple");

  mocks.app.displayMode = "standard";
  await act(async () => { tree = create(createElement(MoreScreen)); });
  expect(json()).toContain("仅在 Web 完成的高级操作");
});
