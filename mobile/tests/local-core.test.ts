import { describe, expect, it } from "vitest";
import {
  clone,
  deleteRecord,
  emptyContent,
  emptyLibrary,
  finishSelection,
  referencedMedia,
  saveRecord,
  validateLibrary,
  type Library,
} from "../src/local/model";
import { LocalStore } from "../src/local/store";
import { decodeManifest, encodeHeader } from "../src/local/backup-format";
const date = "2026-09-16T12:00:00.000Z";
function fixture() {
  const s = emptyLibrary();
  s.media.photo = {
    id: "photo",
    file: "photo.jpg",
    name: "baby.jpg",
    kind: "image",
    bytes: 8,
    sha256: "a".repeat(64),
  };
  s.drafts.draft = {
    id: "draft",
    recordId: null,
    baseRevision: 0,
    content: {
      ...emptyContent(),
      text: "第一次挥手",
      date,
      mediaIds: ["photo"],
      coverId: "photo",
    },
    updatedAt: date,
  };
  return s;
}
describe("device record lifecycle", () => {
  it("keeps auto-saved edits separate from the last explicit save and updates the same identity", () => {
    const s = fixture();
    saveRecord(s, "draft", "record", date);
    s.drafts.edit = {
      id: "edit",
      recordId: "record",
      baseRevision: 1,
      content: { ...clone(s.records.record!), text: "补记" },
      updatedAt: date,
    };
    expect(s.records.record!.text).toBe("第一次挥手");
    saveRecord(s, "edit", "unused", date);
    expect(Object.keys(s.records)).toEqual(["record"]);
    expect(s.records.record!.revision).toBe(2);
    expect(s.records.record!.text).toBe("补记");
    expect(Object.keys(s.drafts)).toEqual([]);
    validateLibrary(s);
  });
  it("preserves both versions on stale edits", () => {
    const s = fixture();
    saveRecord(s, "draft", "record", date);
    s.drafts.edit = {
      id: "edit",
      recordId: "record",
      baseRevision: 0,
      content: { ...emptyContent(), text: "old input" },
      updatedAt: date,
    };
    expect(() => saveRecord(s, "edit", "x", date)).toThrow("原记录已改变");
    expect(s.drafts.edit.content.text).toBe("old input");
    expect(s.records.record!.revision).toBe(1);
  });
  it("rejects empty records", () => {
    const s = fixture();
    s.drafts.draft!.content = emptyContent();
    expect(() => saveRecord(s, "draft", "r", date)).toThrow("写几句话");
  });
  it("deletes record references without deleting other records or their originals", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.records.other = { ...s.records.r!, id: "other" };
    s.albums.a = {
      id: "a",
      name: "album",
      items: [
        { id: "i", recordId: "r" },
        { id: "j", recordId: "other" },
      ],
      coverId: "photo",
      updatedAt: date,
    };
    deleteRecord(s, "r");
    expect(s.albums.a.items.map((i) => i.recordId)).toEqual(["other"]);
    expect(referencedMedia(s).has("photo")).toBe(true);
    validateLibrary(s);
  });
  it.each(["edit", "delete"])(
    "clears unavailable album and selection covers on %s without deleting originals",
    (operation) => {
      const s = fixture();
      saveRecord(s, "draft", "r", date);
      s.albums.a = {
        id: "a",
        name: "Album",
        items: [{ id: "i", recordId: "r" }],
        coverId: "photo",
        updatedAt: date,
      };
      s.selections.q = {
        id: "q",
        albumId: null,
        selected: ["r"],
        name: "Draft album",
        month: "",
        offset: 42,
        coverId: "photo",
      };
      if (operation === "delete") deleteRecord(s, "r");
      else {
        s.drafts.edit = {
          id: "edit",
          recordId: "r",
          baseRevision: 1,
          content: { ...clone(s.records.r!), mediaIds: [], coverId: null },
          updatedAt: date,
        };
        saveRecord(s, "edit", "unused", date);
        expect(s.albums.a.items).toHaveLength(1);
        expect(s.records.r!.revision).toBe(2);
      }
      expect(s.albums.a.coverId).toBeNull();
      expect(s.selections.q.coverId).toBeNull();
      expect(s.selections.q.name).toBe("Draft album");
      expect(s.media.photo).toBeDefined();
      validateLibrary(s);
    },
  );
  it("protects media used only in an unfinished draft or avatar", () => {
    const s = fixture();
    expect(referencedMedia(s).has("photo")).toBe(true);
    s.profile.avatarId = "photo";
    delete s.drafts.draft;
    expect(referencedMedia(s).has("photo")).toBe(true);
  });
  it("album removal cannot delete the original record", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.selections.q = {
      id: "q",
      albumId: null,
      selected: ["r"],
      name: "一岁",
      month: "2026-09",
      offset: 142,
      coverId: "photo",
    };
    finishSelection(s, "q", "a", () => "i", date);
    delete s.albums.a;
    expect(s.records.r?.mediaIds).toEqual(["photo"]);
  });
  it("appends without duplicating selected records and preserves order and cover", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.records.two = { ...s.records.r!, id: "two" };
    s.albums.a = {
      id: "a",
      name: "旅行",
      items: [{ id: "one", recordId: "r" }],
      coverId: "photo",
      updatedAt: date,
    };
    s.selections.q = {
      id: "q",
      albumId: "a",
      selected: ["r", "two"],
      name: "",
      month: "",
      offset: 500,
      coverId: null,
    };
    finishSelection(s, "q", "unused", () => "two", date);
    expect(s.albums.a.items.map((i) => i.recordId)).toEqual(["r", "two"]);
    expect(s.albums.a.coverId).toBe("photo");
    validateLibrary(s);
  });
});
describe("serialized durable state", () => {
  it("rolls back failed writes and continues with the next operation", async () => {
    let disk = emptyLibrary(),
      fail = false;
    const store = new LocalStore({
      read: async () => disk,
      write: async (s) => {
        if (fail) throw new Error("disk full");
        disk = clone(s);
      },
    });
    await store.open();
    fail = true;
    await expect(
      store.change((s) => {
        s.profile.name = "lost";
      }),
    ).rejects.toThrow("disk full");
    expect(store.get().profile.name).toBe("");
    fail = false;
    await store.change((s) => {
      s.profile.name = "saved";
    });
    expect(disk.profile.name).toBe("saved");
  });
  it("serializes concurrent changes without losing either update and reopens identically", async () => {
    let disk: Library | null = null;
    const driver = {
      read: async () => disk,
      write: async (s: Library) => {
        disk = clone(s);
      },
    };
    const store = new LocalStore(driver);
    await store.open();
    await Promise.all([
      store.change(async (s) => {
        await Promise.resolve();
        s.profile.name = "宝宝";
      }),
      store.change((s) => {
        s.welcome = true;
      }),
    ]);
    const reopened = new LocalStore(driver);
    await reopened.open();
    expect(reopened.get().profile.name).toBe("宝宝");
    expect(reopened.get().welcome).toBe(true);
  });
  it("never overwrites an unreadable database with an empty library", async () => {
    let writes = 0;
    const store = new LocalStore({
      read: async () => ({ version: 99 }),
      write: async () => {
        writes++;
      },
    });
    await expect(store.open()).rejects.toThrow();
    expect(writes).toBe(0);
  });
});
describe("complete backup manifest", () => {
  it("roundtrips records, edits, profile, albums, selection position and preferences", () => {
    const s = fixture();
    saveRecord(s, "draft", "r", date);
    s.profile = { name: "小美", birthday: "2025-09-10", avatarId: "photo" };
    s.settings.theme = "dark";
    s.selections.q = {
      id: "q",
      albumId: null,
      selected: ["r"],
      month: "2026-09",
      offset: 258,
      name: "旅行",
      coverId: "photo",
    };
    const header = encodeHeader(s);
    expect(decodeManifest(header.slice(12)).library).toEqual(s);
  });
  it.each(["../secret.jpg", "/absolute.jpg", "http://example.com/a.jpg"])(
    "rejects unsafe media paths %s",
    (file) => {
      const s = fixture();
      s.media.photo!.file = file;
      expect(() => encodeHeader(s)).toThrow();
    },
  );
  it("rejects missing originals and broken album relationships", () => {
    const s = fixture();
    delete s.media.photo;
    expect(() => validateLibrary(s)).toThrow();
    const other = emptyLibrary();
    other.albums.a = {
      id: "a",
      name: "",
      items: [{ id: "i", recordId: "missing" }],
      coverId: null,
      updatedAt: date,
    };
    expect(() => validateLibrary(other)).toThrow();
  });
  it("rejects unsupported versions and active recording snapshots", () => {
    const s = fixture();
    s.drafts.draft!.recordingFile = "recording-test.m4a";
    expect(() => encodeHeader(s)).toThrow("录音");
    const old = { ...emptyLibrary(), version: 2 };
    expect(() => validateLibrary(old)).toThrow();
  });
});
