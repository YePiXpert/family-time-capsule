import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { emptyContent, emptyLibrary, type RecordDraft } from "../src/local/model";
import { AIEditor } from "../src/ai/Editor";

// 钩子槽位模拟挂载与卸载，触发面板的真实按钮回调。
const env = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, cleanups: [] as (() => void)[],
  token: vi.fn(), api: vi.fn(), navigate: vi.fn(), patch: vi.fn(),
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
  useEffect: (effect: () => void | (() => void)) => {
    const i = env.cursor++;
    if (i in env.slots) return;
    env.slots[i] = true;
    const cleanup = effect();
    if (cleanup) env.cleanups.push(cleanup);
  },
}));
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", ScrollView: "ScrollView" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
vi.mock("../src/local/context", () => ({ useLibrary: () => emptyLibrary() }));
vi.mock("../src/local/navigation", () => ({ useNav: () => ({ navigate: env.navigate }) }));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "JournalIcon" }));
vi.mock("../src/ai/client", async () => ({
  api: env.api, getToken: env.token, AIError: (await import("../src/ai/error")).AIError,
}));
vi.mock("../src/local/ui", () => ({
  Button: "Button", Card: "Card", ErrorText: "ErrorText", Text: "Text", ToolButton: "ToolButton",
  SheetModal: "SheetModal", hapticSuccess: vi.fn(),
  messageOf: (e: Error) => e.message, useStyles: () => ({}), useTheme: () => ({ colors: {} }),
}));
type Control = { children?: ReactNode; testID?: string; title?: string; onPress?: () => void };
function controls(node: ReactNode): Control[] {
  if (Array.isArray(node)) return node.flatMap(controls);
  if (!isValidElement<Control>(node)) return [];
  return [node.props, ...controls(node.props.children)];
}
const draft: RecordDraft = {
  id: "draft", recordId: null, baseRevision: 0, updatedAt: "2026-09-24T12:00:00Z",
  content: { ...emptyContent(), title: "窗边", text: "窗边有风。", date: "2026-09-24T12:00:00" },
};
const control = (label: string) => {
  env.cursor = 0;
  return controls(AIEditor({ draft, disabled: false, onPatch: env.patch, onApply: vi.fn() }))
    .find(p => p.testID === label || p.title === label)!;
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.resetAllMocks(); env.slots = []; env.cursor = 0; env.cleanups = [];
  env.token.mockResolvedValue("token");
  env.api.mockResolvedValue({ title: "窗边", text: "窗边有风。" });
  env.patch.mockResolvedValue(undefined);
});
afterEach(() => { env.cleanups.forEach(cleanup => cleanup()); });
it.each(["ai-polish", "ai-ask"])("%s sends nothing when unmounted during the token read", async button => {
  let resolve!: (token: string | null) => void;
  env.token.mockImplementation(() => new Promise(done => { resolve = done; }));
  control(button).onPress!();
  expect(env.token).toHaveBeenCalledOnce();
  env.cleanups.forEach(cleanup => cleanup());
  resolve("token"); await tick();
  expect(env.api).not.toHaveBeenCalled(); expect(env.patch).not.toHaveBeenCalled();
  expect(env.navigate).not.toHaveBeenCalled();
});
it("unmounting before a missing token resolves does not navigate away", async () => {
  let resolve!: (token: null) => void;
  env.token.mockImplementation(() => new Promise(done => { resolve = done; }));
  control("ai-polish").onPress!(); env.cleanups.forEach(cleanup => cleanup());
  resolve(null); await tick();
  expect(env.navigate).not.toHaveBeenCalled(); expect(env.api).not.toHaveBeenCalled();
});
it("a mounted editor still sends and saves a polish proposal", async () => {
  control("ai-polish").onPress!(); await tick();
  expect(env.api).toHaveBeenCalledOnce();
  expect(env.api.mock.lastCall![3].aborted).toBe(false);
  expect(env.patch).toHaveBeenCalledWith(expect.objectContaining({ aiProposal: expect.objectContaining({ text: "窗边有风。" }) }));
});
it("a mounted phone without a token still opens 家庭与同步", async () => {
  env.token.mockResolvedValue(null); control("ai-polish").onPress!(); await tick();
  expect(env.navigate).toHaveBeenCalledWith("Family"); expect(env.api).not.toHaveBeenCalled();
});
it("unmounting after a request starts still aborts it", async () => {
  let resolve!: (value: unknown) => void;
  env.api.mockImplementation(() => new Promise(done => { resolve = done; }));
  control("ai-ask").onPress!(); await tick();
  env.cleanups.forEach(cleanup => cleanup());
  expect(env.api.mock.lastCall![3].aborted).toBe(true);
  resolve({ questions: ["谁在旁边？"], first: false }); await tick();
  expect(env.patch).not.toHaveBeenCalled(); expect(control("ai-ask-q-0")).toBeUndefined();
});
