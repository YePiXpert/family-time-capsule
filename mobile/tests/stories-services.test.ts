import { afterEach, describe, expect, it, vi } from "vitest";
import { clone, editEntity, emptyLibrary, saveRecord, validateLibrary, type Library } from "../src/local/model";
import { LocalStore } from "../src/local/store";
import { beginDraft, beginStoryDraft } from "../src/local/services";
import { STORY_TOPICS } from "../src/local/stories";

vi.mock("expo-crypto", async () => ({ randomUUID: (await import("node:crypto")).randomUUID }));
vi.mock("expo-file-system", () => ({ Paths: {} }));
vi.mock("../src/local/files", () => ({ deleteMediaFiles: vi.fn(), preserveMedia: vi.fn() }));
vi.mock("../modules/share-intake/src", () => ({ consumePendingNativeShares: vi.fn(), acknowledgeNativeShare: vi.fn() }));

afterEach(() => vi.useRealTimers());

async function fixture() {
  let disk: Library = emptyLibrary();
  disk.settings.by = "妈妈";
  const writes: Library[] = [];
  const store = new LocalStore({
    read: async () => disk,
    write: async (next) => { disk = clone(next); writes.push(clone(next)); },
  });
  await store.open();
  return { store, writes, disk: () => disk };
}

describe("故事草稿的本机持久化", () => {
  it("沿用普通草稿路径，一次写入主题、日期、落款与关闭自动日期", async () => {
    const { store, writes, disk } = await fixture();
    const before = writes.length;
    const id = await beginStoryDraft(store, "birth", "2024-03-05");
    expect(writes).toHaveLength(before + 1);
    expect(disk().drafts[id]).toMatchObject({ recordId: null, baseRevision: 0, autoDate: false,
      content: { story: "birth", date: new Date("2024-03-05T10:00:00").toISOString(), by: "妈妈", text: "" } });
    expect(disk().records).toEqual({});
    validateLibrary(disk());
    const regular = await beginDraft(store);
    expect(disk().drafts[regular]!.autoDate).toBe(true);
    expect(disk().drafts[regular]!.content).not.toHaveProperty("story");
  });
  it("其余主题默认今天，保存、重开编辑后仍保留故事", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00.000Z"));
    const { store, disk } = await fixture();
    for (const topic of STORY_TOPICS.filter((t) => t !== "birth")) {
      const id = await beginStoryDraft(store, topic, "2024-03-05");
      expect(disk().drafts[id]!.content.date).toBe("2026-09-21T12:00:00.000Z");
      expect(disk().drafts[id]!.autoDate).toBe(false);
      await store.change((s) => {
        editEntity(s, "drafts", id, (d) => { d.content.text = "故事正文"; });
        saveRecord(s, id, topic, new Date().toISOString());
      });
      const editId = await beginDraft(store, topic);
      expect(disk().drafts[editId]!.content.story).toBe(topic);
      expect(disk().drafts[editId]!.content.by).toBe("妈妈");
    }
    validateLibrary(disk());
  });
  it("写盘失败不留下半份普通草稿", async () => {
    const store = new LocalStore({ read: async () => emptyLibrary(), write: async () => { throw new Error("disk full"); } });
    await store.open();
    await expect(beginStoryDraft(store, "name", "")).rejects.toThrow("disk full");
    expect(store.get().drafts).toEqual({});
  });
});
