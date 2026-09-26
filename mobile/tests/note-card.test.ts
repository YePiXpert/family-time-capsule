import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { NoteCard } from "../src/local/NoteCard";

// 保留 JSX 元素树和钩子槽位，手动重绘并触发真实控件回调，无需原生渲染器。
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  cleanups: [] as (() => void)[],
  updates: 0,
  alert: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.updates++;
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  // 依赖变了才重跑，和 React 一样。
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = hooks.cursor++;
    const prev = hooks.slots[index] as unknown[] | undefined;
    if (prev && deps && prev.length === deps.length && prev.every((d, i) => Object.is(d, deps[i])))
      return;
    hooks.slots[index] = deps ?? [];
    const cleanup = effect();
    if (cleanup) hooks.cleanups.push(cleanup);
  },
}));
vi.mock("react-native", () => ({ View: "View", Alert: { alert: hooks.alert } }));
// 返回守卫：记下最近一次渲染的开关与回调，放行靠 navigation.dispatch。
const nav = vi.hoisted(() => ({
  prevent: false,
  onPrevent: undefined as undefined | ((e: { data: { action: unknown } }) => void),
  navigation: { dispatch: vi.fn() },
}));
vi.mock("@react-navigation/native", () => ({
  usePreventRemove: (prevent: boolean, cb: (e: { data: { action: unknown } }) => void) => {
    nav.prevent = prevent;
    nav.onPrevent = cb;
  },
  useNavigation: () => nav.navigation,
}));
vi.mock("../src/local/ui", () => ({
  Button: "Button",
  ErrorText: "ErrorText",
  Field: "Field",
  Card: "Card",
  Text: "Text",
  messageOf: (error: Error) => error.message,
  useStyles: () => ({}),
  useTheme: () => ({ colors: {} }),
}));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "JournalIcon" }));
type Control = {
  children?: ReactNode;
  testID?: string;
  title?: string;
  value?: string;
  disabled?: boolean;
  onPress?: () => void;
  onChangeText?: (value: string) => void;
};
function find(
  node: ReactNode,
  matches: (props: Control) => boolean,
): Control | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, matches);
      if (found) return found;
    }
  }
  if (!isValidElement<Control>(node)) return;
  return matches(node.props) ? node.props : find(node.props.children, matches);
}
function setup(typedFirst?: string) {
  let resolve!: (text: string) => void;
  const generate = vi.fn((_signal?: AbortSignal) =>
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  const render = () => {
    hooks.cursor = 0;
    return NoteCard({
      heading: "爸爸妈妈的话",
      placeholder: "写几句",
      emptyHint: "写几句",
      note: "原有寄语",
      testPrefix: "note",
      onSave: async () => {},
      assist: { generate },
    });
  };
  const control = (id: string) =>
    find(render(), (p) => p.testID === `note-${id}`)!;
  const cancel = () => find(render(), (p) => p.title === "取消")!;
  control("edit").onPress!();
  if (typedFirst !== undefined) control("input").onChangeText!(typedFirst);
  control("assist").onPress!();
  const complete = async () => {
    resolve("AI 的草稿");
    await new Promise((done) => setTimeout(done, 0));
  };
  return { control, cancel, complete, generate };
}
beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.cleanups = [];
  hooks.updates = 0;
  hooks.alert.mockReset();
  nav.prevent = false;
  nav.onPrevent = undefined;
  nav.navigation.dispatch.mockReset();
});
afterEach(() => {
  for (const cleanup of hooks.cleanups) cleanup();
});

it("asks before replacing words typed while AI was drafting and can keep them", async () => {
  const p = setup();
  p.control("input").onChangeText!("等待时亲手写的几句");
  await p.complete();
  expect(p.control("input").value).toBe("等待时亲手写的几句");
  expect(hooks.alert).toHaveBeenCalledOnce();
  const buttons = hooks.alert.mock.calls[0]![2];
  buttons.find((b: { text: string }) => b.text === "保留我写的").onPress?.();
  expect(p.control("input").value).toBe("等待时亲手写的几句");
});
it("uses the AI version only after explicit acceptance if the draft changed", async () => {
  const p = setup();
  p.control("input").onChangeText!("自己写的");
  await p.complete();
  expect(p.control("input").value).toBe("自己写的");
  const buttons = hooks.alert.mock.calls[0]![2];
  buttons.find((b: { text: string }) => b.text === "用 AI 这版").onPress();
  expect(p.control("input").value).toBe("AI 的草稿");
});
it("fills an unchanged draft directly", async () => {
  const p = setup();
  await p.complete();
  expect(p.control("input").value).toBe("AI 的草稿");
  expect(hooks.alert).not.toHaveBeenCalled();
});
it("asks before replacing words typed but not saved before tapping AI", async () => {
  const p = setup("还没保存的一段");
  await p.complete();
  expect(p.control("input").value).toBe("还没保存的一段");
  expect(hooks.alert).toHaveBeenCalledOnce();
  expect(hooks.alert.mock.calls[0]![1]).toContain("还没保存");
  const buttons = hooks.alert.mock.calls[0]![2];
  buttons.find((b: { text: string }) => b.text === "保留我写的").onPress?.();
  expect(p.control("input").value).toBe("还没保存的一段");
});
it("fills an emptied draft directly", async () => {
  const p = setup("");
  await p.complete();
  expect(p.control("input").value).toBe("AI 的草稿");
  expect(hooks.alert).not.toHaveBeenCalled();
});
it("aborts on cancel and ignores a result arriving in a later editing session", async () => {
  const p = setup();
  expect(p.cancel().disabled).toBe(false);
  p.cancel().onPress!();
  p.control("edit").onPress!();
  await p.complete();
  expect(p.control("input").value).toBe("原有寄语");
  expect(p.generate.mock.calls[0]![0]?.aborted).toBe(true);
  expect(hooks.alert).not.toHaveBeenCalled();
});
it("aborts on unmount and ignores late results", async () => {
  const p = setup();
  for (const cleanup of hooks.cleanups) cleanup();
  const updates = hooks.updates;
  await p.complete();
  expect(hooks.updates).toBe(updates);
  expect(p.generate.mock.calls[0]![0]?.aborted).toBe(true);
  expect(hooks.alert).not.toHaveBeenCalled();
});
it("ignores a pending replacement choice after cancel", async () => {
  const p = setup();
  p.control("input").onChangeText!("自己写的");
  await p.complete();
  expect(hooks.alert).toHaveBeenCalledOnce();
  const buttons = hooks.alert.mock.calls[0]![2];
  p.cancel().onPress!();
  p.control("edit").onPress!();
  buttons.find((b: { text: string }) => b.text === "用 AI 这版").onPress();
  expect(p.control("input").value).toBe("原有寄语");
});

function editing(onSave: (value: string) => Promise<void>) {
  const render = () => {
    hooks.cursor = 0;
    return NoteCard({
      heading: "爸爸妈妈的话",
      placeholder: "写几句",
      emptyHint: "写几句",
      note: "原有寄语",
      testPrefix: "note",
      onSave,
    });
  };
  const control = (id: string) => find(render(), (p) => p.testID === `note-${id}`)!;
  control("edit").onPress!();
  return { render, control };
}
const BACK = { type: "GO_BACK" };
const back = () => nav.onPrevent!({ data: { action: BACK } });
const choose = (text: string) =>
  (hooks.alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[])
    .find((b) => b.text === text)!
    .onPress?.();
const settle = () => new Promise((done) => setTimeout(done, 0));

it("寄语写了没保存：返回、侧滑被拦下先问；没改过不拦", () => {
  const p = editing(async () => {});
  p.render();
  expect(nav.prevent).toBe(false);
  p.control("input").onChangeText!("这一年你学会了走路");
  p.render();
  expect(nav.prevent).toBe(true);
  back();
  expect(hooks.alert).toHaveBeenCalledOnce();
  choose("继续写");
  p.render();
  expect(p.control("input").value).toBe("这一年你学会了走路");
  expect(nav.navigation.dispatch).not.toHaveBeenCalled();
});

it("寄语没保存时选「保存」：存好再走，存的是框里的字", async () => {
  const onSave = vi.fn(async () => {});
  const p = editing(onSave);
  p.control("input").onChangeText!("  这一年你学会了走路  ");
  p.render();
  back();
  choose("保存");
  await settle();
  p.render();
  expect(onSave).toHaveBeenCalledWith("这一年你学会了走路");
  expect(nav.prevent).toBe(false);
  expect(nav.navigation.dispatch).toHaveBeenCalledWith(BACK);
});

it("寄语没保存时选「保存」但存不上：留在页上看错误，不走", async () => {
  const p = editing(async () => {
    throw new Error("写不进去");
  });
  p.control("input").onChangeText!("这一年你学会了走路");
  p.render();
  back();
  choose("保存");
  await settle();
  expect(find(p.render(), (c) => "message" in c && (c as { message?: string }).message === "写不进去")).toBeDefined();
  expect(nav.navigation.dispatch).not.toHaveBeenCalled();
  expect(nav.prevent).toBe(true);
});

it("寄语没保存时选「不保存」：放弃改动后放行", () => {
  const onSave = vi.fn(async () => {});
  const p = editing(onSave);
  p.control("input").onChangeText!("这一年你学会了走路");
  p.render();
  back();
  choose("不保存");
  p.render();
  expect(onSave).not.toHaveBeenCalled();
  expect(nav.navigation.dispatch).toHaveBeenCalledWith(BACK);
});

it("保存途中按返回：存好之后再走", async () => {
  let finish!: () => void;
  const p = editing(() => new Promise<void>((done) => (finish = done)));
  p.control("input").onChangeText!("这一年你学会了走路");
  p.control("save").onPress!();
  p.render();
  back();
  expect(hooks.alert).not.toHaveBeenCalled();
  expect(nav.navigation.dispatch).not.toHaveBeenCalled();
  finish();
  await settle();
  p.render();
  expect(nav.navigation.dispatch).toHaveBeenCalledWith(BACK);
});
