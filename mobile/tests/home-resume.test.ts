import { createContext, createElement, useContext, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraftContent, type DraftContent } from "../src/drafts/model";
import { resumableDrafts, resumableDraftTitle } from "../src/drafts/resumable";
import type { LocalDraft } from "../src/drafts/store";
import type { LocalTimelineEvent } from "../src/types";
import { onThisDay } from "../src/utils/on-this-day";

const mocks = vi.hoisted(() => ({ list: vi.fn<(scope: string) => Promise<LocalDraft[]>>() }));
const Focus = createContext(false);
vi.mock("../src/drafts/store", () => ({ listLocalDrafts: mocks.list }));
vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const focused = useContext(Focus);
    useEffect(() => focused ? effect() : undefined, [effect, focused]);
  },
}));
const { useResumableDrafts } = await import("../src/drafts/use-resumable-drafts");

const scopeA = JSON.stringify(["https://family.invalid", "instance", "owner-a", "family-a"]);
const scopeB = JSON.stringify(["https://family.invalid", "instance", "owner-b", "family-a"]);
function draft(id: string, patch: Partial<Omit<LocalDraft, "content">> = {}, content: Partial<DraftContent> = {}): LocalDraft {
  return {
    id, scope: scopeA, status: "editing", mutationId: `mutation-${id}`,
    revision: 1, serverRevision: 0, memoryEventId: null, updatedAt: "2026-09-16T00:00:00.000Z",
    ...patch, content: { ...emptyDraftContent(), text: "还没有写完的故事", ...content },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("unfinished writing on the home screen", () => {
  it("isolates the full account/family scope and excludes completed, discarded and empty drafts", () => {
    const rows = [
      draft("unfinished"),
      draft("supplement", { savedContent: { ...emptyDraftContent(), text: "已保存的正文" } }),
      ...(["queued", "published", "discarded"] as const).map(status => draft(status, { status })),
      draft("pending-discard", { discardPending: true }),
      draft("blank", {}, { text: " \n ", title: "\t", locationText: "只有地点", participantIds: ["child"] }),
      draft("other-account", { scope: scopeB }),
      draft("other-family", { scope: JSON.stringify(["https://family.invalid", "instance", "owner-a", "family-b"]) }),
      draft("other-instance", { scope: JSON.stringify(["https://family.invalid", "replacement", "owner-a", "family-a"]) }),
      draft("other-server", { scope: JSON.stringify(["https://other.invalid", "instance", "owner-a", "family-a"]) }),
      draft("local", { scope: "local" }),
    ];
    expect(resumableDrafts(rows, scopeA).map(row => row.id)).toEqual(["supplement", "unfinished"]);
    expect(resumableDrafts(rows, "local").map(row => row.id)).toEqual(["local"]);
  });

  it("offers title-only and media-only drafts, latest first with stable ties, without reordering the source", () => {
    const rows = Object.freeze([
      draft("older", { updatedAt: "2026-09-15T23:59:59.000Z" }),
      draft("z-photo", {}, { text: "", items: [{ id: "image", assetId: null, localCaptureRef: "photo", caption: "" }] }),
      draft("a-title", {}, { text: "", title: "  生日还没写完  " }),
    ]);
    const result = resumableDrafts(rows, scopeA);
    expect(result.map(row => row.id)).toEqual(["a-title", "z-photo", "older"]);
    expect(rows.map(row => row.id)).toEqual(["older", "z-photo", "a-title"]);
    expect(result.map(resumableDraftTitle)).toEqual(["生日还没写完", "1 份照片与声音", "还没有写完的故事"]);
    expect(resumableDraftTitle(draft("long", {}, { text: `  ${"字".repeat(80)}  ` }))).toBe("字".repeat(60));
  });
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
function Hook({ scope, enabled }: { scope: string | null; enabled: boolean }) {
  return createElement("ResumeState", { value: useResumableDrafts(scope, enabled) });
}
async function render(scope: string | null, enabled = true, focused = true) {
  const node = createElement(Focus.Provider, { value: focused }, createElement(Hook, { scope, enabled }));
  await act(async () => { if (tree) tree.update(node); else tree = create(node); });
}
function state(): ReturnType<typeof useResumableDrafts> {
  return tree!.root.findByType("ResumeState" as never).props.value;
}
beforeEach(() => { mocks.list.mockReset(); });
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; });

describe("home draft refresh", () => {
  it("reads only when focused and removes a saved draft when returning home", async () => {
    mocks.list.mockResolvedValueOnce([draft("story")]).mockResolvedValueOnce([draft("story", { status: "queued" })]);
    await render(scopeA, true, false);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(state()).toBeNull();
    await render(scopeA);
    expect(state()?.rows.map(row => row.id)).toEqual(["story"]);
    await render(scopeA, true, false);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await render(scopeA);
    expect(mocks.list.mock.calls).toEqual([[scopeA], [scopeA]]);
    expect(state()).toMatchObject({ scope: scopeA, rows: [], error: null });
  });

  it.each(["resolve", "reject"] as const)("hides the prior account immediately and ignores its late %s", async late => {
    const oldRefresh = deferred<LocalDraft[]>(), newAccount = deferred<LocalDraft[]>();
    mocks.list.mockResolvedValueOnce([draft("old-story")]).mockReturnValueOnce(oldRefresh.promise).mockReturnValueOnce(newAccount.promise);
    await render(scopeA);
    expect(state()?.rows[0]?.id).toBe("old-story");
    await render(scopeA, true, false);
    await render(scopeA);
    await render(scopeB);
    // No new-account read has completed yet: prior titles must already be gone.
    expect(state()).toBeNull();
    await act(async () => newAccount.resolve([draft("new-story", { scope: scopeB }), draft("wrong-scope")]));
    expect(state()?.rows.map(row => row.id)).toEqual(["new-story"]);
    await act(async () => {
      if (late === "resolve") oldRefresh.resolve([draft("late-old-story")]);
      else oldRefresh.reject(new Error("old family's storage read failed"));
    });
    expect(state()).toMatchObject({ scope: scopeB, rows: [{ id: "new-story" }], error: null });
  });

  it.each(["disabled", "no-identity"] as const)("hides loaded writing when %s and ignores pending results", async condition => {
    const pending = deferred<LocalDraft[]>();
    mocks.list.mockResolvedValueOnce([draft("private-story")]).mockReturnValueOnce(pending.promise);
    await render(scopeA);
    await render(scopeA, true, false);
    await render(scopeA);
    await render(condition === "no-identity" ? null : scopeA, condition !== "disabled");
    expect(state()).toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve([draft("late-private-story")]));
    expect(state()).toBeNull();
  });

  it("shows a storage error without stale draft titles and recovers on the next focus", async () => {
    mocks.list.mockResolvedValueOnce([draft("story")]).mockRejectedValueOnce(new Error("disk read failed")).mockResolvedValueOnce([draft("recovered")]);
    await render(scopeA);
    await render(scopeA, true, false);
    await render(scopeA);
    expect(state()).toMatchObject({ rows: [], error: "暂时无法读取未完成记录" });
    await render(scopeA, true, false);
    await render(scopeA);
    expect(state()).toMatchObject({ rows: [{ id: "recovered" }], error: null });
  });
});

function memory(id: string, occurredAt: string, occurredAtPrecision = "exact"): LocalTimelineEvent {
  return {
    id, title: "某个值得记住的日子", occurredAt, occurredAtPrecision, updatedAt: occurredAt,
    locationText: null, childPersonId: null, ageDays: null, ageLabel: null,
    assetCount: 0, participantNames: [], captureIds: [], cover: null,
    localCoverUri: null, source: "server", syncState: null,
  };
}

describe("on this day", () => {
  it.each([
    ["exact", true], ["date_only", true], ["approximate", false],
    ["month", false], ["year", false], ["unknown", false],
  ] as const)("uses %s dates only when their calendar day is explicitly known", (precision, known) => {
    const event = memory("event", "2025-09-16T04:00:00.000Z", precision);
    expect(onThisDay([event], "2026-09-16", "Asia/Shanghai")).toEqual(known ? { event, yearsAgo: 1 } : null);
  });

  it.each([
    ["Asia/Shanghai", "2025-09-15T17:00:00.000Z", "2026-09-16", "2026-09-15"],
    ["America/New_York", "2025-09-16T02:00:00.000Z", "2026-09-15", "2026-09-16"],
  ])("uses the family date in %s across UTC midnight", (timezone, occurredAt, familyDay, utcDay) => {
    const event = memory("boundary", occurredAt);
    expect(onThisDay([event], familyDay, timezone)).toEqual({ event, yearsAgo: 1 });
    expect(onThisDay([event], utcDay, timezone)).toBeNull();
  });

  it("excludes this year, future years and other days, then picks the nearest earlier year consistently", () => {
    const expected = memory("a-last-year", "2025-09-16T08:00:00Z");
    const events = [
      memory("this-year", "2026-09-16T00:00:00Z"), memory("future", "2027-09-16T00:00:00Z"),
      memory("other-day", "2025-09-17T00:00:00Z"), memory("older", "2020-09-16T00:00:00Z"),
      memory("z-last-year", "2025-09-16T07:00:00Z"), expected,
    ];
    expect(onThisDay(events, "2026-09-16", "UTC")).toEqual({ event: expected, yearsAgo: 1 });
    expect(onThisDay([...events].reverse(), "2026-09-16", "UTC")).toEqual({ event: expected, yearsAgo: 1 });
    expect(onThisDay(events.slice(0, 3), "2026-09-16", "UTC")).toBeNull();
  });

  it("does not turn invalid dates or leap-day anchors into a different calendar day", () => {
    const leap = memory("leap", "2024-02-29T00:00:00Z");
    expect(onThisDay([leap], "2026-02-28", "UTC")).toBeNull();
    expect(onThisDay([leap], "2028-02-29", "UTC")).toEqual({ event: leap, yearsAgo: 4 });
    expect(onThisDay([memory("broken", "not-a-date")], "2026-09-16", "UTC")).toBeNull();
    expect(onThisDay([leap], "2028-02-29", "Invalid/Timezone")).toBeNull();
    expect(onThisDay([leap], "today", "UTC")).toBeNull();
    expect(onThisDay([], "2026-09-16", "UTC")).toBeNull();
  });
});
