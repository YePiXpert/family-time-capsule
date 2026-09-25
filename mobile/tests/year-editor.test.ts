import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { emptyContent, emptyLibrary, type Library } from "../src/local/model";
import { YearEditor } from "../src/local/Year";

// 沿用 NoteCard 的钩子槽位测试：触发真实按钮回调，观察联网与落库边界。
const env = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, cleanups: [] as (() => void)[],
  state: undefined as Library | undefined,
  token: vi.fn(), api: vi.fn(), navigate: vi.fn(), change: vi.fn(),
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
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
vi.mock("../src/local/context", () => ({ useLibrary: () => env.state, useStore: () => ({ change: env.change }) }));
vi.mock("../src/local/navigation", () => ({ useNav: () => ({ navigate: env.navigate }) }));
vi.mock("../src/local/services", () => ({ now: () => "2026-09-21T12:00:00Z" }));
vi.mock("../src/ai/client", () => ({ api: env.api, getToken: env.token }));
vi.mock("../src/local/ui", () => ({
  Button: "Button", Card: "Card", ErrorText: "ErrorText", Ornament: "Ornament", Page: "Page", SectionHeader: "SectionHeader", PersonChips: "PersonChips", Text: "Text",
  dateLabel: (date: string) => date.slice(0, 10), monthLabel: (month: string) => month,
  messageOf: (e: Error) => e.message, useStyles: () => ({}), useVolumeWidth: () => 140,
}));
vi.mock("../src/local/ShelfCards", () => ({ coverForRecords: vi.fn() }));
vi.mock("../src/local/Volume", () => ({ Volume: "Volume" }));
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
const result = () => ({ title: "窗边的小脚", chapters: [{ month: "2026-09", picks: ["1"], quote: { recordId: "1", text: "窗边有风。" } }], notes: "每月挑一段。" });
beforeEach(() => {
  vi.clearAllMocks(); env.slots = []; env.cursor = 0; env.cleanups = [];
  env.state = emptyLibrary();
  env.state.records.r = { ...emptyContent(), id: "r", revision: 1, updatedAt: "2026-09-21T10:00:00Z", date: "2026-09-10T12:00:00", title: "窗边的小脚", text: "窗边有风。", by: "爸爸" };
  env.token.mockResolvedValue("token");
  env.api.mockResolvedValue(result());
  env.change.mockImplementation(async (apply: (lib: Library) => void) => apply(env.state!));
});
afterEach(() => { env.cleanups.forEach(cleanup => cleanup()); });
it("the suggest button sends the year straight away; only apply persists", async () => {
  expect(env.api).not.toHaveBeenCalled();
  control("year-editor-suggest")!.onPress!(); await tick();
  expect(env.api).toHaveBeenCalledOnce();
  const [path, body, method, signal] = env.api.mock.lastCall!;
  expect(path).toBe("/ai/write"); expect(method).toBe("POST"); expect(signal.aborted).toBe(false);
  expect(body).toMatchObject({ photos: [], writingMode: "editor" });
  expect(JSON.parse(body.context).records[0]).toMatchObject({ id: "1", by: "爸爸", text: "窗边有风。" });
  expect(control("year-editor-preview")).toBeDefined(); expect(env.change).not.toHaveBeenCalled();
  control("不引")!.onPress!();
  control("year-editor-apply")!.onPress!(); await tick();
  expect(env.state!.yearPicks!["2026"]!.months["2026-09"]!.quote).toBeUndefined();
  expect(env.state!.yearPicks!["2026"]!.updatedAt).toBe("2026-09-21T12:00:00Z");
  control("year-editor-clear")!.onPress!(); await tick();
  expect(env.state!.yearPicks).toBeUndefined();
});
it("a phone that has not joined is taken to 家庭与同步 and never sends the year", async () => {
  env.token.mockResolvedValue(null); control("year-editor-suggest")!.onPress!(); await tick();
  expect(env.navigate).toHaveBeenCalledWith("Family"); expect(env.api).not.toHaveBeenCalled();
  expect(controls(render()).some(p => p.message?.includes("先在「家庭与同步」加入家庭"))).toBe(true);
});
it("stopping while the device token is still being read sends nothing", async () => {
  let give!: (token: string) => void;
  env.token.mockImplementation(() => new Promise(done => { give = done; }));
  control("year-editor-suggest")!.onPress!();
  control("停止")!.onPress!(); give("token"); await tick();
  expect(env.api).not.toHaveBeenCalled();
});
it.each(["stop", "unmount"])("%s aborts the request and ignores its late result", async action => {
  let resolve!: (value: unknown) => void;
  env.api.mockImplementation(() => new Promise(done => { resolve = done; }));
  control("year-editor-suggest")!.onPress!(); await tick();
  if (action === "stop") control("停止")!.onPress!(); else env.cleanups.forEach(cleanup => cleanup());
  expect(env.api.mock.lastCall![3].aborted).toBe(true);
  resolve(result()); await tick(); expect(control("year-editor-preview")).toBeUndefined(); expect(env.change).not.toHaveBeenCalled();
});
it("removing the last pick omits its month; discarding the preview never changes the library", async () => {
  control("year-editor-suggest")!.onPress!(); await tick();
  control("不要")!.onPress!(); expect(control("不引")).toBeUndefined();
  control("不用")!.onPress!(); expect(control("year-editor-preview")).toBeUndefined(); expect(env.change).not.toHaveBeenCalled();
});
it("invalid server suggestions show the specific error without offering apply", async () => {
  const invalid = result(); invalid.chapters[0]!.quote.text = "编出来的"; env.api.mockResolvedValue(invalid);
  control("year-editor-suggest")!.onPress!(); await tick();
  expect(control("year-editor-preview")).toBeUndefined();
  expect(controls(render()).some(p => p.message === "AI 的目录建议不合规矩，请重试。")).toBe(true);
});
it("an empty year disables the suggestion action", () => {
  env.state!.records = {}; expect(control("year-editor-suggest")!.disabled).toBe(true);
});
it.each([400, 401])("the inline limit note appears only above 400 records (%i)", count => {
  const record = env.state!.records.r!;
  env.state!.records = Object.fromEntries(Array.from({ length: count }, (_, i) => [`r${i}`, { ...record, id: `r${i}` }]));
  const notes = controls(render()).filter(p => Array.isArray(p.children) && p.children.join("").includes("AI 只读最新 400 段"));
  expect(notes).toHaveLength(count > 400 ? 1 : 0);
  if (count > 400) expect((notes[0]!.children as ReactNode[]).join("")).toBe("这一年有 401 段，AI 只读最新 400 段。");
  expect(control("year-editor-suggest")).toBeDefined();
});
