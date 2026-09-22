import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { emptyContent, emptyLibrary, type Library } from "../src/local/model";
import { YearEditor } from "../src/local/Year";

// 沿用 NoteCard 的钩子槽位测试：触发真实按钮／Alert 回调，观察联网与落库边界。
const env = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, cleanups: [] as (() => void)[],
  state: undefined as Library | undefined,
  alert: vi.fn(), token: vi.fn(), consent: vi.fn(), agree: vi.fn(), api: vi.fn(), navigate: vi.fn(), change: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const i = env.cursor++;
    if (!(i in env.slots)) env.slots[i] = initial;
    return [env.slots[i], (next: unknown) => { env.slots[i] = typeof next === "function" ? next(env.slots[i]) : next; }];
  },
  useRef: (initial: unknown) => {
    const i = env.cursor++;
    if (!(i in env.slots)) env.slots[i] = { current: initial };
    return env.slots[i];
  },
  useEffect: (effect: () => () => void) => {
    const i = env.cursor++;
    if (i in env.slots) return;
    env.slots[i] = true; env.cleanups.push(effect());
  },
}));
vi.mock("react-native", () => ({ View: "View", Alert: { alert: env.alert }, Pressable: "Pressable" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
vi.mock("../src/local/context", () => ({ useLibrary: () => env.state, useStore: () => ({ change: env.change }) }));
vi.mock("../src/local/navigation", () => ({ useNav: () => ({ navigate: env.navigate }) }));
vi.mock("../src/local/services", () => ({ now: () => "2026-09-21T12:00:00Z" }));
vi.mock("../src/ai/client", () => ({ api: env.api, getToken: env.token, hasConsent: env.consent, giveConsent: env.agree }));
vi.mock("../src/local/ui", () => ({
  Button: "Button", Card: "Card", ErrorText: "ErrorText", Ornament: "Ornament", Page: "Page", SectionHeader: "SectionHeader", PersonChips: "PersonChips", Text: "Text",
  dateLabel: (date: string) => date.slice(0, 10), monthLabel: (month: string) => month,
  messageOf: (e: Error) => e.message, useStyles: () => ({}), useVolumeWidth: () => 140,
}));
vi.mock("../src/local/Shelf", () => ({ coverForRecords: vi.fn(), Volume: "Volume" }));
vi.mock("../src/local/NoteCard", () => ({ NoteCard: "NoteCard" }));
vi.mock("../src/local/BookBinder", () => ({ planBook: vi.fn(), useBookBinder: vi.fn() }));
vi.mock("../src/local/BookPreview", () => ({ BookPreview: "BookPreview" }));
vi.mock("../src/local/PhotoPicker", () => ({ PhotoPicker: "PhotoPicker" }));

type Control = { children?: ReactNode; testID?: string; title?: string; message?: string; disabled?: boolean; onPress?: () => void };
function controls(node: ReactNode): Control[] {
  if (Array.isArray(node)) return node.flatMap(controls);
  if (!isValidElement<Control>(node)) return [];
  return [node.props, ...controls(node.props.children)];
}
const render = () => {
  env.cursor = 0;
  return YearEditor({ year: "2026", records: Object.values(env.state!.records) });
};
const control = (label: string) => controls(render()).find(p => p.testID === label || p.title === label);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function answer(label: string) {
  const buttons = env.alert.mock.lastCall![2] as { text: string; onPress: () => void }[];
  buttons.find(b => b.text === label)!.onPress();
}
const result = () => ({ title: "窗边的小脚", chapters: [{ month: "2026-09", picks: ["r"], quote: { recordId: "r", text: "窗边有风。" } }], notes: "每月挑一段。" });
beforeEach(() => {
  vi.clearAllMocks(); env.slots = []; env.cursor = 0; env.cleanups = [];
  env.state = emptyLibrary();
  env.state.records.r = { ...emptyContent(), id: "r", revision: 1, updatedAt: "2026-09-21T10:00:00Z", date: "2026-09-10T12:00:00", title: "窗边的小脚", text: "窗边有风。", by: "爸爸" };
  env.token.mockResolvedValue("token"); env.consent.mockResolvedValue(true); env.agree.mockResolvedValue(undefined);
  env.api.mockResolvedValue(result());
  env.change.mockImplementation(async (apply: (lib: Library) => void) => apply(env.state!));
});
afterEach(() => { env.cleanups.forEach(cleanup => cleanup()); });
it("requires general consent then a fresh annual Alert; only explicit send requests, only apply persists", async () => {
  env.consent.mockResolvedValue(false);
  control("year-editor-suggest")!.onPress!(); await tick();
  expect(env.alert.mock.lastCall![0]).toBe("用 AI 建议目录");
  expect(env.api).not.toHaveBeenCalled();
  answer("同意并继续"); await tick();
  expect(env.agree).toHaveBeenCalledOnce();
  expect(env.alert.mock.lastCall![0]).toBe("送整年文字给 AI？");
  expect(env.alert.mock.lastCall![1]).toContain("2026 年全部 1 段时光");
  expect(env.api).not.toHaveBeenCalled();
  answer("发送"); await tick();
  expect(env.api).toHaveBeenCalledOnce();
  const [path, body, method, signal] = env.api.mock.lastCall!;
  expect(path).toBe("/ai/write"); expect(method).toBe("POST"); expect(signal.aborted).toBe(false);
  expect(body).toMatchObject({ photos: [], writingMode: "editor" });
  expect(JSON.parse(body.context).records[0]).toMatchObject({ id: "r", by: "爸爸", text: "窗边有风。" });
  expect(control("year-editor-preview")).toBeDefined(); expect(env.change).not.toHaveBeenCalled();
  control("不引")!.onPress!();
  control("year-editor-apply")!.onPress!(); await tick();
  expect(env.state!.yearPicks!["2026"]!.months["2026-09"]!.quote).toBeUndefined();
  expect(env.state!.yearPicks!["2026"]!.updatedAt).toBe("2026-09-21T12:00:00Z");
  control("year-editor-clear")!.onPress!(); await tick();
  expect(env.state!.yearPicks).toBeUndefined();
});
it("a previous general consent still requires the task Alert and cancel sends nothing", async () => {
  control("year-editor-suggest")!.onPress!(); await tick();
  expect(env.alert).toHaveBeenCalledOnce(); expect(env.alert.mock.lastCall![0]).toBe("送整年文字给 AI？");
  answer("取消"); await tick(); expect(env.api).not.toHaveBeenCalled(); expect(env.change).not.toHaveBeenCalled();
});
it("canceling general consent or not being signed in never sends the year", async () => {
  env.consent.mockResolvedValue(false);
  control("year-editor-suggest")!.onPress!(); await tick(); answer("取消"); await tick();
  expect(env.alert).toHaveBeenCalledOnce(); expect(env.api).not.toHaveBeenCalled();
  env.token.mockResolvedValue(null); control("year-editor-suggest")!.onPress!(); await tick();
  expect(env.navigate).toHaveBeenCalledWith("AISettings"); expect(env.api).not.toHaveBeenCalled();
  expect(controls(render()).some(p => p.message?.includes("先在「AI 设置」加入服务"))).toBe(true);
});
it("stopping while the confirmation is open prevents even a later send callback", async () => {
  control("year-editor-suggest")!.onPress!(); await tick();
  control("停止")!.onPress!(); answer("发送"); await tick();
  expect(env.api).not.toHaveBeenCalled();
});
it.each(["stop", "unmount"])("%s aborts the request and ignores its late result", async action => {
  let resolve!: (value: unknown) => void;
  env.api.mockImplementation(() => new Promise(done => { resolve = done; }));
  control("year-editor-suggest")!.onPress!(); await tick(); answer("发送"); await tick();
  if (action === "stop") control("停止")!.onPress!(); else env.cleanups.forEach(cleanup => cleanup());
  expect(env.api.mock.lastCall![3].aborted).toBe(true);
  resolve(result()); await tick(); expect(control("year-editor-preview")).toBeUndefined(); expect(env.change).not.toHaveBeenCalled();
});
it("removing the last pick omits its month; discarding the preview never changes the library", async () => {
  control("year-editor-suggest")!.onPress!(); await tick(); answer("发送"); await tick();
  control("不要")!.onPress!(); expect(control("不引")).toBeUndefined();
  control("不用")!.onPress!(); expect(control("year-editor-preview")).toBeUndefined(); expect(env.change).not.toHaveBeenCalled();
});
it("invalid server suggestions show the specific error without offering apply", async () => {
  const invalid = result(); invalid.chapters[0]!.quote.text = "编出来的"; env.api.mockResolvedValue(invalid);
  control("year-editor-suggest")!.onPress!(); await tick(); answer("发送"); await tick();
  expect(control("year-editor-preview")).toBeUndefined();
  expect(controls(render()).some(p => p.message === "AI 的目录建议不合规矩，请重试。")).toBe(true);
});
it("an empty year disables the suggestion action", () => {
  env.state!.records = {}; expect(control("year-editor-suggest")!.disabled).toBe(true);
});
