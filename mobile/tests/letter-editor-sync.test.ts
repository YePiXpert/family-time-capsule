import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { emptyLibrary, type Library, type LocalLetter } from "../src/local/model";
import { contentHashOf, lineage } from "../src/local/hash";
import { emptyBase, fingerprintOf, mergeLibraries } from "../src/sync/merge";
import { usePreventRemove } from "@react-navigation/native";
import { LetterEditor } from "../src/local/LetterEditor";

// 写信页开着时同步改了这封信：不悄悄盖掉家里的改动，也不把人困在页上。
// 与 editor-flow 同一套：钩子按槽位重绘，仓库直接改 env.lib。
const env = vi.hoisted(() => ({
  slots: [] as unknown[],
  setters: [] as ((next: unknown) => void)[],
  cursor: 0,
  cleanups: new Map<number, () => void>(),
  lib: undefined as unknown as Library,
  dispatch: vi.fn(),
  goBack: vi.fn(),
  replace: vi.fn(),
  ids: 0,
}));
const sameDeps = (a: unknown, b: unknown[] | undefined) =>
  Array.isArray(a) && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = env.cursor++;
    if (!(i in env.slots))
      env.slots[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    env.setters[i] ??= (next: unknown) => {
      env.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(env.slots[i]) : next;
    };
    return [env.slots[i], env.setters[i]];
  },
  useRef: (initial: unknown) => {
    const i = env.cursor++;
    if (!(i in env.slots)) env.slots[i] = { current: initial };
    return env.slots[i];
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
  Alert: { alert: vi.fn() },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Linking: { openSettings: vi.fn() },
  Platform: { OS: "android" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { hairlineWidth: 1 },
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("@react-navigation/native", () => ({ usePreventRemove: vi.fn() }));
vi.mock("@react-native-community/datetimepicker", () => ({ default: "DateTimePicker" }));
vi.mock("expo-audio", () => ({
  AudioModule: {}, RecordingPresets: {}, requestRecordingPermissionsAsync: vi.fn(), setAudioModeAsync: vi.fn(),
}));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: {} }));
vi.mock("../src/local/files", () => ({ preserveMedia: vi.fn(), verifyMedia: vi.fn() }));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "JournalIcon" }));
// services 连着原生分享模块：只留写信页用到的几样；落盘走真的 letters.writeLetter。
vi.mock("../src/local/services", () => ({
  now: () => "2026-09-26T08:00:00.000Z",
  newId: () => `rescued-${++env.ids}`,
  deleteLetter: vi.fn(),
  sealLetter: vi.fn(),
}));
vi.mock("../src/local/context", () => ({ useStore: () => store, useLibrary: () => env.lib }));
vi.mock("../src/local/ui", () => ({
  BottomBar: "BottomBar", Button: "Button", Card: "Card", DateStrip: "DateStrip", ErrorText: "ErrorText",
  IconButton: "IconButton", Page: "Page", Text: "Text", hapticSuccess: vi.fn(),
  messageOf: (e: Error) => e.message, serif: "serif", useKeyboardBarOffset: () => 0,
  useSheetViewport: () => ({ viewport: 0, height: 0, measure: () => {} }),
  useStyles: () => ({}), useTheme: () => ({ colors: {}, large: false }), TEXT_MAX_SCALE: 1.3,
}));
const store = {
  get: () => env.lib,
  change: async <T>(fn: (s: Library) => T): Promise<T> => fn(env.lib),
};
type Control = { testID?: string; accessibilityLabel?: string; value?: string; onChangeText?: (t: string) => void; children?: ReactNode };
function nodes(node: ReactNode): { type: unknown; props: Control }[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Control>(node)) return [];
  return [node as { type: unknown; props: Control }, ...nodes(node.props.children)];
}
const render = () => {
  env.cursor = 0;
  return LetterEditor({
    route: { params: { id: "L" } },
    navigation: { dispatch: env.dispatch, goBack: env.goBack, replace: env.replace },
  } as unknown as Parameters<typeof LetterEditor>[0]) as ReactNode;
};
const textInputs = () => nodes(render()).filter((n) => n.type === "TextInput");
beforeEach(() => {
  env.slots = []; env.setters = []; env.cursor = 0; env.cleanups = new Map();
  env.lib = emptyLibrary();
  env.ids = 0;
  env.dispatch.mockReset();
  vi.mocked(usePreventRemove).mockClear();
});
afterEach(() => { for (const c of env.cleanups.values()) c(); });

const v1: LocalLetter = {
  id: "L", title: "给十八岁的你", text: "亲爱的桉桉：", from: "妈妈", openAt: "2043-01-01",
  writtenAt: "2026-09-20T00:00:00.000Z", sealed: false, mediaIds: [], coverId: null,
  updatedAt: "2026-09-20T00:00:00.000Z",
};
const fromDad = {
  ...v1, text: "亲爱的桉桉：\n爸爸也想说：我们爱你。", updatedAt: "2026-09-26T07:00:00.000Z",
  ancestors: lineage(v1),
};
const type = (text: string) =>
  textInputs().find((n) => n.props.testID === "letter-text")!.props.onChangeText!(text);
const debounce = () => new Promise((done) => setTimeout(done, 450));
const back = async () => {
  const onRemove = vi.mocked(usePreventRemove).mock.calls.at(-1)![1] as (e: { data: { action: unknown } }) => void;
  onRemove({ data: { action: { type: "GO_BACK" } } });
  await new Promise((done) => setTimeout(done, 20));
  render();
};

it("开着没动时并进爸爸的改动：换成新的一版接着写，写下的一版源自爸爸那版", async () => {
  env.lib.letters.L = v1;
  render();
  env.lib.letters.L = fromDad; // 自动同步快进
  render();
  expect(textInputs().find((n) => n.props.testID === "letter-text")!.props.value).toContain("爸爸也想说");
  type("亲爱的桉桉：\n爸爸也想说：我们爱你。\n妈妈也是。");
  await debounce();
  const stored = env.lib.letters.L!;
  expect(stored.text).toContain("爸爸也想说");
  expect(stored.ancestors?.[0]).toBe(contentHashOf(fromDad).slice(0, 16));
});

it("打字还没落盘时并进爸爸的改动：留自己写的，世系不冒认爸爸那版，爸爸手机合并时把他那版留成冲突卡", async () => {
  env.lib.letters.L = v1;
  render();
  type("亲爱的桉桉：今天你学会了走路。");
  env.lib.letters.L = fromDad; // 落盘前同步快进
  render();
  await debounce();
  const mine = env.lib.letters.L!;
  expect(mine.text).toBe("亲爱的桉桉：今天你学会了走路。");
  expect(mine.ancestors).toEqual(lineage(v1));
  // 爸爸那台手机：本机就是自己发布过的那版，收到妈妈这版。
  const dad = { ...emptyLibrary(), letters: { L: fromDad } };
  const base = { ...emptyBase(), merged: { letters: { L: fingerprintOf(fromDad) } } };
  const merged = mergeLibraries(
    dad,
    [{ deviceId: "mum", deviceName: "妈妈的手机", createdAt: "2026-09-26T08:01:00.000Z", library: { ...emptyLibrary(), letters: { L: mine } } }],
    base,
    "2026-09-26T08:02:00.000Z",
  );
  expect(merged.next.letters.L!.text).toBe(mine.text);
  expect(merged.conflicts.map((c) => (c.loser as LocalLetter).text)).toEqual([fromDad.text]);
});

it("这封信在别的手机被删、这边没再写：按返回直接出去，不另存", async () => {
  env.lib.letters.L = v1;
  render();
  delete env.lib.letters.L; // 同步带来墓碑
  render();
  await back();
  expect(env.dispatch).toHaveBeenCalledOnce();
  expect(Object.keys(env.lib.letters)).toEqual([]);
});

it("这封信在别的手机被删、这边接着写了：另存成一封新信并说明，按返回照常出去", async () => {
  env.lib.letters.L = v1;
  render();
  delete env.lib.letters.L;
  type("亲爱的桉桉：今天你学会了走路。");
  await debounce();
  const rescued = env.lib.letters["rescued-1"]!;
  expect(rescued).toMatchObject({ text: "亲爱的桉桉：今天你学会了走路。", sealed: false, from: "妈妈" });
  expect(rescued.ancestors).toBeUndefined();
  expect(env.lib.letters.L).toBeUndefined();
  expect(nodes(render()).some((n) => String((n.props as { children?: unknown }).children ?? "").includes("另存为一封新信"))).toBe(true);
  // 之后的改动落到新信上，不再另存第二封。
  type("亲爱的桉桉：今天你学会了走路。还叫了妈妈。");
  await debounce();
  expect(Object.keys(env.lib.letters)).toEqual(["rescued-1"]);
  expect(env.lib.letters["rescued-1"]!.text).toContain("还叫了妈妈");
  await back();
  expect(env.dispatch).toHaveBeenCalledOnce();
});

it("这封信在别的手机被封存、这边接着写了：封好的那封不动，自己写的另存", async () => {
  env.lib.letters.L = v1;
  render();
  const sealed = { ...v1, sealed: true, updatedAt: "2026-09-26T07:30:00.000Z", ancestors: lineage(v1) };
  env.lib.letters.L = sealed;
  render();
  type("亲爱的桉桉：今天你学会了走路。");
  await debounce();
  expect(env.lib.letters.L).toBe(sealed);
  expect(env.lib.letters["rescued-1"]!.text).toBe("亲爱的桉桉：今天你学会了走路。");
  await back();
  expect(env.dispatch).toHaveBeenCalledOnce();
});
