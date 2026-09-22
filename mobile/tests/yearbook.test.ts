import { describe, expect, it } from "vitest";
import {
  yearBookInput,
  yearBookMonth,
  type YearBookSource,
} from "../src/local/yearbook";

const source = (overrides: Partial<YearBookSource> = {}): YearBookSource => ({
  year: "2026",
  profileName: "桉桉",
  stats: "2 段时光",
  note: "",
  months: [],
  firsts: [],
  colophon: "2026 年",
  ...overrides,
});
const march = (
  records: YearBookSource["months"][number]["records"],
  label = "三月",
) => ({ label, records });

describe("年度册的内容装配", () => {
  it("把本名与来历带进扉页，未填时不带键，也不凭空补小名", () => {
    const fields = { fullName: "林知夏", motto: "名字来自夏天的第一阵风。" };
    expect(yearBookInput(source(fields)).titlePage).toEqual({ name: "桉桉", ...fields });
    expect(yearBookInput(source()).titlePage).toEqual({ name: "桉桉" });
    for (const key of ["fullName", "motto"] as const) {
      expect(yearBookInput(source()).titlePage).not.toHaveProperty(key);
      expect(yearBookInput(source({ [key]: fields[key] })).titlePage).toEqual({ name: "桉桉", [key]: fields[key] });
    }
    expect(yearBookInput(source({ ...fields, profileName: "" })).titlePage).toEqual({ name: "林知夏", motto: fields.motto });
  });
  it("寄语在最前，空月不出章，「第一次」收在最后", () => {
    const book = yearBookInput(
      source({
        note: "  这一年你学会了走路。  ",
        months: [
          march([
            {
              title: "第一步",
              date: "3月2日",
              text: "扶着沙发挪了三步。",
              photos: [{ key: "a", aspect: 1 }],
            },
          ]),
          march([], "四月"),
        ],
        firsts: [{ title: "第一步", date: "3月2日" }],
      }),
    );
    expect(book.chapters.map((c) => c.heading)).toEqual([
      "爸爸妈妈的话",
      "三月",
      "这一年的第一次",
    ]);
    expect(book.chapters[0]!.blocks).toEqual([
      { kind: "text", body: "这一年你学会了走路。" },
    ]);
    expect(book.title).toBe("桉桉的 2026 年");
    expect(book.stamp).toBe("2026");
  });

  it("一条记录的照片一张不落，且排在这条的文字后面", () => {
    const photos = [
      { key: "a", aspect: 1 },
      { key: "b", aspect: 1.5 },
      { key: "c", aspect: 0.8 },
    ];
    const book = yearBookInput(
      source({
        months: [
          march([{ title: "赶海", date: "3月2日", text: "第一次踩到浪。", photos }]),
        ],
      }),
    );
    expect(book.chapters[0]!.blocks).toEqual([
      { kind: "text", title: "赶海", date: "3月2日", body: "第一次踩到浪。" },
      { kind: "photos", photos },
    ]);
    // 记录带落款时文字块带上它；没落款不多出键。
    const signed = yearBookInput(
      source({
        months: [march([{ title: "赶海", date: "3月2日", text: "第一次踩到浪。", by: "爸爸", photos: [] }])],
      }),
    );
    expect(signed.chapters[0]!.blocks).toEqual([
      { kind: "text", title: "赶海", date: "3月2日", body: "第一次踩到浪。", by: "爸爸" },
    ]);
  });

  it("没有文字的记录不排空正文，没有寄语与第一次就不出那两章", () => {
    const book = yearBookInput(
      source({
        months: [
          march([
            { title: " ", date: "3月2日", text: "  ", photos: [{ key: "a", aspect: 1 }] },
          ]),
        ],
      }),
    );
    expect(book.chapters.map((c) => c.heading)).toEqual(["三月"]);
    expect(book.chapters[0]!.blocks).toEqual([
      { kind: "photos", photos: [{ key: "a", aspect: 1 }] },
    ]);
  });

  it("没填名字时落到桉桉，生日有才排进扉页", () => {
    expect(yearBookInput(source({ profileName: "  " })).title).toBe(
      "桉桉的 2026 年",
    );
    expect(yearBookInput(source()).titlePage).toEqual({ name: "桉桉" });
    expect(
      yearBookInput(source({ birthday: "2025 年 9 月 10 日" })).titlePage,
    ).toEqual({ name: "桉桉", birthday: "2025 年 9 月 10 日" });
  });
});

describe("annual book editor assembly", () => {
  const records = [
    { id: "a", title: "第一段", date: "9月1日", text: "窗边有风。", photos: [{ key: "p", aspect: 1 }] },
    { id: "b", title: "第二段", date: "9月2日", text: "伸出小脚。", photos: [] },
    { id: "c", title: "第三段", date: "9月3日", text: "抓住窗帘。", photos: [] },
  ];
  const project = ({ id: _id, ...record }: typeof records[number]) => record;
  it("binds monthly picks in directory order, quotes in lead and a proposed title", () => {
    const book = yearBookInput(source({ title: "窗边的小脚", months: [
      { label: "九月", ...yearBookMonth(records, { recordIds: ["b", "a"], quote: { recordId: "c", text: "抓住窗帘。" } }, project) },
      { label: "十月", ...yearBookMonth(records, undefined, project) },
    ], note: "给你", firsts: [{ title: "第一次", date: "9月1日" }],
    }));
    expect(book.title).toBe("窗边的小脚");
    expect(book.subtitle).toBe(`桉桉的 2026 年 · ${source().stats}`);
    expect(book.chapters.map(c => c.heading)).toEqual(["爸爸妈妈的话", "九月", "十月", "这一年的第一次"]);
    const month = book.chapters[1]!;
    expect(month.lead).toBe("「抓住窗帘。」\n2 段时光 · 1 张照片");
    expect(month.blocks.filter(b => b.kind === "text").map(b => b.title)).toEqual(["第二段", "第一段"]);
    expect(book.chapters[2]!.blocks.filter(b => b.kind === "text")).toHaveLength(3);
    expect(book.chapters[0]!.blocks[0]).toMatchObject({ body: "给你" });
  });
  it("without a directory produces byte-identical book input to the previous assembly", () => {
    const previous = source({ months: [{ label: "九月", lead: "3 段时光 · 1 张照片", records: records.map(project) }] });
    const next = source({ months: [{ label: "九月", ...yearBookMonth(records, undefined, project) }] });
    expect(JSON.stringify(yearBookInput(next))).toBe(JSON.stringify(yearBookInput(previous)));
    expect(yearBookInput(next).title).toBe("桉桉的 2026 年");
    expect(yearBookInput(next).subtitle).toBe(source().stats);
  });
});
