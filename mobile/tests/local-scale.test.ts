import { expect, it } from "vitest";
import { LocalStore, type LibraryDisk } from "../src/local/store";
import {
  emptyContent,
  emptyLibrary,
  type Library,
  type LocalMedia,
  type LocalRecord,
} from "../src/local/model";

/**
 * 「十年之库」的规模基准：5 年 · 万条记录 · 万段素材。
 * 这里不测界面，只测一次 change() 要付出多少代价。落盘字节量是确定值，
 * 耗时只用来兜住数量级——CI 机器快慢差几倍，别把它当精确指标。
 */
const RECORDS = 10000;
const MEDIA = 10000;
const PERSONS = 6;
const ALBUMS = 40;

/** 预算见文件末尾「基线」。收紧时连同那段一起改。 */
const OPEN_MS_BUDGET = 1500;
const CHANGE_MS_BUDGET = 1500;
const CHANGE_BYTE_BUDGET = 8 * 1024 * 1024;

const hex = (n: number) => n.toString(16).padStart(64, "0");
const day = (i: number) =>
  new Date(Date.UTC(2021, 0, 1) + (i % 1800) * 86400000).toISOString();

function bigLibrary(): Library {
  const s = emptyLibrary();
  s.profile.name = "小美";
  s.profile.birthday = "2021-01-01";
  for (let i = 0; i < PERSONS; i++)
    s.persons[`p${i}`] = { id: `p${i}`, name: `家人${i}` };
  for (let i = 0; i < MEDIA; i++) {
    const id = `m${i.toString().padStart(6, "0")}`;
    const media: LocalMedia = {
      id,
      file: `${id}.jpg`,
      name: `成长照片-${i}.jpg`,
      kind: "image",
      bytes: 2_400_000 + i,
      sha256: hex(i),
      width: 4032,
      height: 3024,
      thumb: `${id}_t.jpg`,
      photoMetadata: {
        capturedAt: day(i),
        latitude: 31.2304 + (i % 100) / 10000,
        longitude: 121.4737 + (i % 100) / 10000,
      },
    };
    s.media[id] = media;
  }
  for (let i = 0; i < RECORDS; i++) {
    const id = `r${i.toString().padStart(6, "0")}`;
    const mediaId = `m${(i % MEDIA).toString().padStart(6, "0")}`;
    const record: LocalRecord = {
      ...emptyContent(),
      id,
      title: `第 ${i} 个值得记住的日子`,
      text: `今天她又长大了一点点。${"记下来的小事，将来都是大事。".repeat(4)}`,
      date: day(i),
      location: i % 3 ? "" : "上海市徐汇区",
      first: i % 50 === 0,
      mediaIds: [mediaId],
      coverId: mediaId,
      personIds: [`p${i % PERSONS}`],
      revision: 1,
      updatedAt: day(i),
    };
    s.records[id] = record;
  }
  for (let i = 0; i < ALBUMS; i++) {
    const id = `a${i}`;
    s.albums[id] = {
      id,
      name: `相册 ${i}`,
      items: Array.from({ length: 50 }, (_, n) => ({
        id: `${id}-${n}`,
        recordId: `r${(i * 50 + n).toString().padStart(6, "0")}`,
      })),
      coverId: null,
      updatedAt: day(i),
    };
  }
  return s;
}

/** 记录每次落盘真正要序列化多少字节——今天是整库，将来应该只有脏实体。 */
function openBig() {
  const writes: number[] = [];
  const library = bigLibrary();
  const disk: LibraryDisk = {
    read: async () => library,
    write: async (state) => {
      writes.push(JSON.stringify(state).length);
    },
  };
  const store = new LocalStore(disk);
  const started = Date.now();
  return store.open().then(() => ({
    store,
    writes,
    openMs: Date.now() - started,
  }));
}

it("opens a ten-year library within the boot budget", async () => {
  const { store, writes, openMs } = await openBig();
  expect(Object.keys(store.get().records)).toHaveLength(RECORDS);
  expect(Object.keys(store.get().media)).toHaveLength(MEDIA);
  // 开库只读不写：现有库绝不能在启动时被整库重写一遍。
  expect(writes).toHaveLength(0);
  expect(openMs).toBeLessThan(OPEN_MS_BUDGET);
});

it("keeps one keystroke edit inside the change budget", async () => {
  const { store, writes, openMs } = await openBig();
  const id = `r${(RECORDS - 1).toString().padStart(6, "0")}`;
  const started = Date.now();
  await store.change((s) => {
    s.records[id] = { ...s.records[id]!, text: `${s.records[id]!.text}啊` };
  });
  const changeMs = Date.now() - started;
  const libraryBytes = JSON.stringify(store.get()).length;
  console.log(
    `[scale] ${RECORDS} 记录 / ${MEDIA} 素材：整库 ${(libraryBytes / 1048576).toFixed(1)}MB，` +
      `开库 ${openMs}ms，改一个字 ${changeMs}ms，落盘 ${(writes[0]! / 1048576).toFixed(1)}MB`,
  );
  expect(store.get().records[id]!.text.endsWith("啊")).toBe(true);
  expect(writes).toHaveLength(1);
  expect(writes[0]!).toBeLessThan(CHANGE_BYTE_BUDGET);
  expect(changeMs).toBeLessThan(CHANGE_MS_BUDGET);
});

/**
 * 基线（Build 62，node 24 开发机）：整库 6.2MB，开库 32ms，改一个字 90ms，
 * 落盘 6.2MB——改一个字把整个库重写了一遍。手机上 Hermes 没有 JIT，再叠加
 * synchronous=FULL 的整行写，这一下要慢得多。
 * 63-3 的实体表落地后，CHANGE_BYTE_BUDGET 收到 64KB。
 */
