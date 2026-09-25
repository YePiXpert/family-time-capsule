import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { emptyLibrary, type Library, type RecordDraft } from "../src/local/model";
import { useFocusGuard } from "../src/local/navigation";
import { CaptureFab } from "../src/local/CaptureFab";
import { Shelf } from "../src/local/Shelf";
import { Month } from "../src/local/Home";

// 钩子按槽位保存，手动重绘；useFocusEffect 收下回调，focus() 模拟页面回到前台。
const env = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  focusEffects: [] as (() => void)[],
  navigate: vi.fn(),
  beginDraft: vi.fn(),
  library: undefined as unknown,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = env.cursor++;
    if (!(index in env.slots)) env.slots[index] = initial;
    return [
      env.slots[index],
      (next: unknown) => {
        env.slots[index] =
          typeof next === "function" ? next(env.slots[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = env.cursor++;
    if (!(index in env.slots)) env.slots[index] = { current: initial };
    return env.slots[index];
  },
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: () => {},
}));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (effect: () => void) => {
    env.focusEffects.push(effect);
  },
  useNavigation: () => ({ navigate: env.navigate }),
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  SectionList: "SectionList",
  StyleSheet: { absoluteFill: {}, hairlineWidth: 1 },
  View: "View",
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-native-reanimated", () => {
  const chain = { delay: () => chain, duration: () => chain };
  return { default: { View: "Animated.View" }, FadeInUp: chain };
});
vi.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "JournalIcon" }));
vi.mock("../src/local/Media", () => ({ Photo: "Photo" }));
vi.mock("../src/local/backup", () => ({ daysSinceExport: () => null }));
vi.mock("../src/local/context", () => ({
  useLibrary: () => env.library,
  useStore: () => ({}),
  useSyncStatus: () => ({ joined: false, conflicts: 0, running: false }),
}));
vi.mock("../src/local/services", () => ({
  beginDraft: env.beginDraft,
  beginLetter: vi.fn(),
  beginSelection: vi.fn(),
  now: () => "2026-09-25T00:00:00.000Z",
}));
vi.mock("../src/local/ui", () => {
  // 书架按 s.footnote.lineHeight 这类行高算首屏：任何样式名都给一个行高。
  const styles = new Proxy({}, { get: () => ({ lineHeight: 20 }) });
  return {
    Button: "Button", Card: "Card", DateStrip: "DateStrip", ErrorText: "ErrorText",
    Field: "Field", Glass: "Glass", IconButton: "IconButton", Ornament: "Ornament",
    Page: "Page", SectionHeader: "SectionHeader", SettingsRow: "SettingsRow",
    Stamp: "Stamp", Text: "Text",
    MOTION: { pressScale: 0.97, glassPressScale: 0.95 },
    dateLabel: (iso: string) => iso.slice(0, 10),
    monthLabel: (key: string) => key,
    hapticLight: () => {},
    messageOf: (e: Error) => e.message,
    serif: "serif",
    useLargeLayout: () => false,
    usePressScale: () => ({ style: {}, onPressIn: () => {}, onPressOut: () => {} }),
    useStyles: () => styles,
    useTextScale: () => 1,
    useTheme: () => ({ colors: {}, dark: false, large: false, liquid: false, reduceMotion: true }),
  };
});

type Props = {
  testID?: string;
  title?: string;
  disabled?: boolean;
  message?: string;
  drafts?: { id: string }[];
  action?: { label: string };
  onPress?: () => void;
  [key: string]: unknown;
};
type Node = { type: unknown; props: Props };
// 连 ListEmptyComponent 这类放在属性里的元素一起走一遍。
function nodes(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const element = node as unknown as Node;
  return [element, ...Object.values(element.props).flatMap(nodes)];
}
const byTestID = (tree: unknown, id: string) =>
  nodes(tree).find((el) => el.props.testID === id);

/** 重绘：槽位保留，焦点回调换成这一次登记的。 */
function render<T>(component: () => T): T {
  env.cursor = 0;
  env.focusEffects = [];
  return component();
}
/** 页面回到前台（从编辑页退回来）。 */
const focus = () => {
  for (const effect of env.focusEffects) effect();
};
const settle = () => new Promise((done) => setTimeout(done, 0));

const draft = (
  id: string,
  over: Partial<RecordDraft> & { title?: string } = {},
): RecordDraft => {
  const { title = "", ...rest } = over;
  return {
    id,
    recordId: null,
    baseRevision: 0,
    content: {
      title, text: "", date: "2020-01-01T00:00:00.000Z", location: "",
      first: false, mediaIds: [], coverId: null,
    },
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...rest,
  };
};
function library(drafts: RecordDraft[] = []): Library {
  const lib = emptyLibrary();
  lib.drafts = Object.fromEntries(drafts.map((d) => [d.id, d]));
  return lib;
}

beforeEach(() => {
  vi.clearAllMocks();
  env.slots = [];
  env.cursor = 0;
  env.focusEffects = [];
  env.library = library();
  let n = 0;
  env.beginDraft.mockImplementation(async () => `draft-${++n}`);
});

it("#14 useFocusGuard：只认第一下，页面回到前台或出错放行后才再认", () => {
  const guard = () => render(() => useFocusGuard());
  expect(guard().take()).toBe(true);
  // 转场途中再点：重绘后仍拒绝。
  expect(guard().take()).toBe(false);
  expect(guard().take()).toBe(false);
  focus();
  expect(guard().take()).toBe(true);
  expect(guard().take()).toBe(false);
  guard().release();
  expect(guard().take()).toBe(true);
});

it("#14 悬浮钮：跳转后按钮已恢复可点，转场中再点也不多建草稿，回到前台后照常", async () => {
  const fab = () => byTestID(render(CaptureFab), "capture-new")!;
  fab().props.onPress!();
  await settle();
  expect(env.navigate).toHaveBeenCalledWith("Editor", { draftId: "draft-1" });
  // busy 已经在 finally 里清掉：挡住第二下的只能是守卫。
  expect(fab().props.disabled).toBe(false);
  fab().props.onPress!();
  await settle();
  expect(env.beginDraft).toHaveBeenCalledOnce();
  expect(env.navigate).toHaveBeenCalledOnce();
  focus();
  fab().props.onPress!();
  await settle();
  expect(env.beginDraft).toHaveBeenCalledTimes(2);
  expect(env.navigate).toHaveBeenLastCalledWith("Editor", { draftId: "draft-2" });
});

it("#14 悬浮钮：建草稿失败显示错误并放行，不用离开页面就能再试", async () => {
  env.beginDraft.mockRejectedValueOnce(new Error("写不进去"));
  const tree = () => render(CaptureFab);
  byTestID(tree(), "capture-new")!.props.onPress!();
  await settle();
  expect(nodes(tree()).find((el) => el.type === "ErrorText")!.props.message).toBe("写不进去");
  expect(env.navigate).not.toHaveBeenCalled();
  byTestID(tree(), "capture-new")!.props.onPress!();
  await settle();
  expect(env.beginDraft).toHaveBeenCalledTimes(2);
  expect(env.navigate).toHaveBeenCalledOnce();
});

it("#14 书架「记一刻」：转场中连点只建一份草稿，回到前台后照常", async () => {
  const capture = () => byTestID(render(Shelf), "capture-first")!;
  capture().props.onPress!();
  await settle();
  capture().props.onPress!();
  await settle();
  expect(env.beginDraft).toHaveBeenCalledOnce();
  expect(env.navigate).toHaveBeenCalledOnce();
  focus();
  capture().props.onPress!();
  await settle();
  expect(env.beginDraft).toHaveBeenCalledTimes(2);
});

it("#14 月册空页「记一刻」：转场中连点只建一份草稿，回到前台后照常", async () => {
  const month = () => Month({ route: { params: { month: "2026-09" } } } as Parameters<typeof Month>[0]);
  const capture = () =>
    nodes(render(month)).find((el) => el.type === "Button" && el.props.title === "记一刻")!;
  capture().props.onPress!();
  await settle();
  capture().props.onPress!();
  await settle();
  expect(env.beginDraft).toHaveBeenCalledOnce();
  expect(env.navigate).toHaveBeenCalledOnce();
  focus();
  capture().props.onPress!();
  await settle();
  expect(env.beginDraft).toHaveBeenCalledTimes(2);
});

it("#14 书架草稿：空白新草稿不挂「上次没写完」，有内容的新草稿和改记录的草稿照常", () => {
  env.library = library([
    draft("blank", { updatedAt: "2020-01-03T00:00:00.000Z" }),
    draft("typed", { title: "第一次翻身", updatedAt: "2020-01-02T00:00:00.000Z" }),
    // 改记录的草稿即使内容全空也留着：原记录要靠它存回去。
    draft("edit", { recordId: "r1", updatedAt: "2020-01-01T00:00:00.000Z" }),
  ]);
  const card = nodes(render(Shelf)).find((el) => Array.isArray(el.props.drafts))!;
  expect(card.props.drafts!.map((d) => d.id)).toEqual(["typed", "edit"]);
});

it("#14 书架草稿：只有一份空白新草稿时既没有草稿卡，也不催「继续写」", () => {
  env.library = library([draft("blank")]);
  const tree = render(Shelf);
  expect(nodes(tree).find((el) => "drafts" in el.props)).toBeUndefined();
  expect(byTestID(tree, "resume-blank")).toBeUndefined();
  expect(nodes(tree).filter((el) => el.props.action?.label === "继续写")).toEqual([]);
});
