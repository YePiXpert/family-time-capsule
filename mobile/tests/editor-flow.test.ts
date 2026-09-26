import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import {
  emptyContent,
  emptyLibrary,
  type Library,
  type LocalMedia,
  type RecordDraft,
} from "../src/local/model";
import { Editor } from "../src/local/Editor";

// 真实的 Editor 按钩子槽位重绘（依赖变了才重跑 effect、重建 memo／callback），
// 草稿落盘走真实的 useDraftPersist；只替换原生模块、界面组件与仓库。
const env = vi.hoisted(() => ({
  slots: [] as unknown[],
  setters: [] as ((next: unknown) => void)[],
  cursor: 0,
  cleanups: new Map<number, () => void>(),
  lib: undefined as unknown as Library,
  // 设了就让仓库写入停在这里，模拟「正在保存」。
  hold: null as Promise<void> | null,
  platform: { OS: "android" },
  alert: vi.fn(),
  popTo: vi.fn(),
  navigate: vi.fn(),
  goBack: vi.fn(),
  dispatch: vi.fn(),
  exif: {} as Record<string, unknown>,
  transcription: {
    status: "idle",
    message: "",
    stop: vi.fn(),
    begin: vi.fn(),
  },
}));
const sameDeps = (a: unknown, b: unknown[] | undefined) =>
  Array.isArray(a) &&
  !!b &&
  a.length === b.length &&
  a.every((x, i) => Object.is(x, b[i]));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = env.cursor++;
    if (!(i in env.slots))
      env.slots[i] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    // setter 跨次重绘保持同一个，和 React 一样；useDraftPersist 的 useCallback 依赖它。
    env.setters[i] ??= (next: unknown) => {
      env.slots[i] =
        typeof next === "function"
          ? (next as (v: unknown) => unknown)(env.slots[i])
          : next;
    };
    return [env.slots[i], env.setters[i]];
  },
  useRef: (initial: unknown) => {
    const i = env.cursor++;
    if (!(i in env.slots)) env.slots[i] = { current: initial };
    return env.slots[i];
  },
  useMemo: (factory: () => unknown, deps?: unknown[]) => {
    const i = env.cursor++;
    const slot = env.slots[i] as { deps: unknown; value: unknown } | undefined;
    if (slot && sameDeps(slot.deps, deps)) return slot.value;
    const value = factory();
    env.slots[i] = { deps, value };
    return value;
  },
  useCallback: (fn: unknown, deps?: unknown[]) => {
    const i = env.cursor++;
    const slot = env.slots[i] as { deps: unknown; value: unknown } | undefined;
    if (slot && sameDeps(slot.deps, deps)) return slot.value;
    env.slots[i] = { deps, value: fn };
    return fn;
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const i = env.cursor++;
    const slot = env.slots[i] as { deps: unknown } | undefined;
    if (slot && sameDeps(slot.deps, deps)) return;
    env.cleanups.get(i)?.();
    env.cleanups.delete(i);
    env.slots[i] = { deps };
    const cleanup = effect();
    if (cleanup) env.cleanups.set(i, cleanup);
  },
}));
vi.mock("react-native", () => ({
  Alert: { alert: env.alert },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Linking: { openSettings: vi.fn() },
  Platform: env.platform,
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { hairlineWidth: 1 },
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("@react-navigation/native", () => ({ usePreventRemove: vi.fn() }));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: "DateTimePicker",
}));
vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({
    canceled: false,
    assets: [
      { uri: "file:///picked.jpg", fileName: "照片.jpg", type: "image", exif: env.exif },
    ],
  }),
  launchCameraAsync: vi.fn(),
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("expo-audio", () => ({
  AudioModule: {},
  RecordingPresets: {},
  requestRecordingPermissionsAsync: vi.fn(),
  setAudioModeAsync: vi.fn(),
}));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: {} }));
vi.mock("../src/local/files", () => ({
  preserveMedia: vi.fn(
    async (_uri: string, name: string, kind: LocalMedia["kind"]) =>
      ({ id: "m-photo", file: "m-photo.jpg", name, kind, bytes: 1, sha256: "0" }) as LocalMedia,
  ),
  verifyMedia: vi.fn(async () => {}),
  deleteMediaFiles: vi.fn(),
  mediaFile: vi.fn(),
}));
// services 连着分享入口等原生模块，只留 Editor 与 useDraftPersist 用到的几样（updateDraft 在 model 里，照原样）。
vi.mock("../src/local/services", () => ({
  newId: () => "new-id",
  now: () => "2026-09-25T08:00:00.000Z",
  createPerson: vi.fn(),
}));
vi.mock("../src/local/context", () => ({
  useStore: () => store,
  useLibrary: () => env.lib,
}));
vi.mock("../src/local/dailyQuestionHooks", () => ({
  useDailyQuestion: () => ({ question: null, source: "local", useLocal: vi.fn() }),
}));
vi.mock("../src/local/transcribeHooks", () => ({
  useTranscription: () => env.transcription,
}));
vi.mock("../src/ai/Editor", () => ({ AIEditor: "AIEditor" }));
vi.mock("../src/local/Media", () => ({ Photo: "Photo", PhotoDetails: "PhotoDetails" }));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "JournalIcon" }));
vi.mock("../src/local/ui", () => ({
  BottomBar: "BottomBar",
  Button: "Button",
  Card: "Card",
  DateStrip: "DateStrip",
  ErrorText: "ErrorText",
  FieldRow: "FieldRow",
  IconButton: "IconButton",
  Page: "Page",
  PersonChips: "PersonChips",
  SignatureButton: "SignatureButton",
  Text: "Text",
  ToolButton: "ToolButton",
  dateLabel: (date: string) => date.slice(0, 10),
  serif: "serif",
  hapticSuccess: vi.fn(),
  messageOf: (e: Error) => e.message,
  useKeyboardBarOffset: () => 0,
  useSheetViewport: () => ({ viewport: 0, height: 0, measure: () => {} }),
  useStyles: () => ({}),
  useTheme: () => ({ colors: {}, large: false }),
  TEXT_MAX_SCALE: 1.3,
}));
// 仓库：真实地改 env.lib；hold 设着时每次写入都等它放行。
const store = {
  get: () => env.lib,
  change: async <T>(fn: (s: Library) => T): Promise<T> => {
    if (env.hold) await env.hold;
    return fn(env.lib);
  },
};

type Control = {
  children?: ReactNode;
  testID?: string;
  title?: string;
  label?: string;
  editable?: boolean;
  disabled?: boolean;
  selected?: string[];
  onPress?: () => void;
  onToggle?: (id: string) => void;
  onChange?: (event: { type: string }, date?: Date) => void;
};
type Node = { type: unknown; props: Control };
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Control>(node)) return [];
  return [node as Node, ...nodes(node.props.children)];
}
const navigation = {
  popTo: env.popTo,
  navigate: env.navigate,
  goBack: env.goBack,
  dispatch: env.dispatch,
};
const render = () => {
  env.cursor = 0;
  return Editor({
    route: { params: { draftId: "d" } },
    navigation,
  } as unknown as Parameters<typeof Editor>[0]) as ReactNode;
};
const all = () => nodes(render());
const byId = (id: string) => all().find((n) => n.props.testID === id)?.props;
const byType = (type: string) => all().find((n) => n.type === type)?.props;
const tool = (label: string) =>
  all().find((n) => n.type === "ToolButton" && n.props.label === label)!.props;
const tick = () => new Promise((done) => setTimeout(done, 0));
function held() {
  let release!: () => void;
  env.hold = new Promise<void>((done) => {
    release = done;
  });
  return () => {
    env.hold = null;
    release();
  };
}
/** 按「保存这一刻」，等到页面放行离开（effect 里取出去处）。 */
async function saveAndLeave() {
  byId("capture-save")!.onPress!();
  await vi.waitFor(() => {
    render();
    expect(env.popTo).toHaveBeenCalledOnce();
  });
}
const image = (id: string): LocalMedia => ({
  id, file: `${id}.jpg`, name: "照片.jpg", kind: "image", bytes: 1, sha256: "0",
});
function newDraft(patch: Partial<RecordDraft> = {}): RecordDraft {
  return {
    id: "d",
    recordId: null,
    baseRevision: 0,
    autoDate: true,
    autoLocation: true,
    updatedAt: "2026-09-25T07:00:00.000Z",
    content: {
      ...emptyContent(),
      date: "2026-09-25T07:00:00.000Z",
      text: "她第一次自己翻身",
    },
    ...patch,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  env.slots = [];
  env.setters = [];
  env.cursor = 0;
  env.cleanups = new Map();
  env.hold = null;
  env.platform.OS = "android";
  env.exif = { DateTimeOriginal: "2026:09:18 09:30:00" };
  env.lib = emptyLibrary();
});
afterEach(() => {
  for (const cleanup of env.cleanups.values()) cleanup();
});

// #15 安卓日期选择按取消也算手选日期
it("#15 安卓按取消关掉日期框不算手选：之后加的照片仍按拍摄日期定日子", async () => {
  env.lib.drafts.d = newDraft();
  byId("editor-date")!.onPress!();
  const original = new Date(env.lib.drafts.d.content.date);
  // 安卓取消时也回调 onChange，带着原来的日期。
  byType("DateTimePicker")!.onChange!({ type: "dismissed" }, original);
  expect(byType("DateTimePicker")).toBeUndefined();
  await tick();
  expect(env.lib.drafts.d!.autoDate).toBe(true);
  expect(env.lib.drafts.d!.content.date).toBe("2026-09-25T07:00:00.000Z");
  tool("照片").onPress!();
  await vi.waitFor(() => expect(byId("editor-media-0")).toBeDefined());
  await saveAndLeave();
  expect(env.lib.records["new-id"]!.date).toBe("2026-09-18T09:30:00");
});
it("#15 安卓选好日期（set）才算手选：日期改掉，之后加的照片不再改日子", async () => {
  env.lib.drafts.d = newDraft();
  byId("editor-date")!.onPress!();
  byType("DateTimePicker")!.onChange!(
    { type: "set" },
    new Date("2026-09-01T02:00:00.000Z"),
  );
  expect(byType("DateTimePicker")).toBeUndefined();
  await tick();
  expect(env.lib.drafts.d!.autoDate).toBe(false);
  expect(env.lib.drafts.d!.content.date).toBe("2026-09-01T02:00:00.000Z");
  tool("照片").onPress!();
  await vi.waitFor(() => expect(byId("editor-media-0")).toBeDefined());
  await saveAndLeave();
  expect(env.lib.records["new-id"]!.date).toBe("2026-09-01T02:00:00.000Z");
});

// #16 保存途中改标题、地点、人物、附件会被丢掉
function savingDraft() {
  env.lib.persons = { p1: { id: "p1", name: "外婆" }, p2: { id: "p2", name: "外公" } };
  env.lib.media = { m1: image("m1"), m2: image("m2") };
  env.lib.drafts.d = newDraft({
    content: {
      ...newDraft().content,
      title: "翻身",
      location: "外婆家",
      mediaIds: ["m1", "m2"],
      coverId: "m1",
      personIds: ["p1"],
    },
  });
  // 选中第二张（不是封面）：下面出「设为封面」与「移除」。
  byId("editor-media-1")!.onPress!();
}
it("#16 保存途中标题、地点锁住，设为封面、移除不可点；保存完又能改", async () => {
  savingDraft();
  const unlocked = () => {
    expect(byId("editor-title")!.editable).not.toBe(false);
    expect(byId("editor-location")!.editable).not.toBe(false);
    expect(byId("editor-media-cover")!.disabled).toBeFalsy();
    expect(byId("editor-media-remove")!.disabled).toBeFalsy();
  };
  unlocked();
  const release = held();
  byId("capture-save")!.onPress!();
  expect(byId("capture-save")!.title).toBe("正在保存…");
  expect(byId("editor-title")!.editable).toBe(false);
  expect(byId("editor-location")!.editable).toBe(false);
  expect(byId("editor-media-cover")!.disabled).toBe(true);
  expect(byId("editor-media-remove")!.disabled).toBe(true);
  release();
  await vi.waitFor(() => {
    render();
    expect(env.popTo).toHaveBeenCalledOnce();
  });
  unlocked();
});
it("#16 保存途中点人物不改选择，存下的记录也还是原来的人", async () => {
  savingDraft();
  const release = held();
  byId("capture-save")!.onPress!();
  byType("PersonChips")!.onToggle!("p2");
  byType("PersonChips")!.onToggle!("p1");
  expect(byType("PersonChips")!.selected).toEqual(["p1"]);
  release();
  await vi.waitFor(() => {
    render();
    expect(env.popTo).toHaveBeenCalledOnce();
  });
  expect(env.lib.records["new-id"]!.personIds).toEqual(["p1"]);
});

// #17 从「随便翻翻」进阅读页、改完回来丢了「再翻一页」
it("#17 改完已有记录回阅读页用 merge，保留「随便翻翻」带来的参数", async () => {
  env.lib.records.r1 = {
    ...emptyContent(),
    id: "r1",
    revision: 3,
    updatedAt: "2026-09-20T07:00:00.000Z",
    date: "2026-09-20T07:00:00.000Z",
    text: "原来的正文",
  };
  env.lib.drafts.d = newDraft({
    recordId: "r1",
    baseRevision: 3,
    autoDate: false,
    autoLocation: false,
    content: { ...emptyContent(), date: "2026-09-20T07:00:00.000Z", text: "改过的正文" },
  });
  await saveAndLeave();
  expect(env.popTo).toHaveBeenCalledWith("Record", { id: "r1" }, { merge: true });
  expect(env.lib.records.r1!.text).toBe("改过的正文");
  expect(env.lib.records.r1!.revision).toBe(4);
});
it("编辑途中原记录在别的手机被删、同步把草稿改成新的一段：接着打字不撤销救援，仍能保存", async () => {
  env.lib.records.r1 = {
    ...emptyContent(),
    id: "r1",
    revision: 3,
    updatedAt: "2026-09-20T07:00:00.000Z",
    date: "2026-09-20T07:00:00.000Z",
    text: "原来的正文",
  };
  env.lib.drafts.d = newDraft({
    recordId: "r1",
    baseRevision: 3,
    autoDate: false,
    autoLocation: false,
    content: { ...emptyContent(), date: "2026-09-20T07:00:00.000Z", text: "原来的正文，又写了一段" },
  });
  render();
  // 自动同步合并（src/sync/merge.ts:305-316 的做法）：记录删了，草稿改成一段新的时光。
  delete env.lib.records.r1;
  env.lib.drafts.d = { ...env.lib.drafts.d!, recordId: null, baseRevision: 0 };
  // 妈妈接着写：一次击键（防抖落盘）。
  (all().find((n) => n.props.testID === "capture-text")!.props as unknown as {
    onChangeText: (t: string) => void;
  }).onChangeText("原来的正文，又写了一段。还有一句");
  byId("capture-save")!.onPress!();
  await vi.waitFor(() => {
    render();
    expect((byType("ErrorText") as { message?: string } | undefined)?.message ?? "").toBe("");
    expect(env.popTo).toHaveBeenCalledOnce();
  }, { timeout: 1500 });
  // 存成一段新的时光，一个字不丢。
  expect(env.lib.records["new-id"]?.text).toBe("原来的正文，又写了一段。还有一句");
  expect(env.lib.records.r1).toBeUndefined();
});
