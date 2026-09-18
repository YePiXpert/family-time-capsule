import { describe, expect, it } from "vitest";
import {
  CARD_WIDTH,
  SERIES_STRIP_MAX,
  base64ToBytes,
  layoutKeepSake,
  layoutSeriesStrip,
  pngBytesOfDataUrl,
  sampledIndices,
  wrapText,
} from "../src/local/keepsake";

describe("keepsake card layout", () => {
  it("wraps CJK and ASCII within the given width", () => {
    const cjk = wrapText("小美在公园里学会了放手走路", {
      fontSize: 40,
      maxWidth: 120,
      maxLines: 5,
    });
    expect(cjk.length).toBeGreaterThan(1);
    expect(cjk.join("")).toBe("小美在公园里学会了放手走路");
    // 混排 ASCII 更省宽度：同样宽度能装更多字符。
    const ascii = wrapText("walking in the park", {
      fontSize: 40,
      maxWidth: 120,
      maxLines: 5,
    });
    expect(ascii.length).toBeLessThan(cjk.length);
    // 显式换行被保留，空段落成空行。
    expect(
      wrapText("一\n\n二", { fontSize: 26, maxWidth: 600, maxLines: 9 }),
    ).toEqual(["一", "", "二"]);
  });
  it("clamps long text with an ellipsis on the last line", () => {
    const lines = wrapText("很".repeat(100), {
      fontSize: 40,
      maxWidth: 200,
      maxLines: 3,
    });
    expect(lines).toHaveLength(3);
    expect(lines[2]!.endsWith("…")).toBe(true);
    expect(lines[2]!.length).toBeLessThanOrEqual(6);
  });
  it("grows the card with body text and clamps photo height by aspect", () => {
    const bare = layoutKeepSake({
      date: "2026-09-17",
      title: "第一步",
      text: "短短一句。",
    });
    const richInput = {
      date: "2026-09-17",
      title: "第一步",
      text: "很长的一段话。".repeat(12),
      location: "31.2, 121.5",
      photoAspect: 1,
    };
    const rich = layoutKeepSake(richInput);
    expect(rich.height).toBeGreaterThan(bare.height);
    expect(rich.photo?.h).toBeGreaterThan(0);
    // 极端宽/窄照片都被夹在纸面可接受范围内。
    const wide = layoutKeepSake({ ...richInput, photoAspect: 4 });
    const tall = layoutKeepSake({ ...richInput, photoAspect: 0.5 });
    expect(wide.photo!.h).toBeLessThan(tall.photo!.h);
    expect(tall.photo!.h / tall.photo!.w).toBeLessThanOrEqual(1.2);
  });
  it("decodes PNG data URLs and bare base64 back to the original bytes", () => {
    expect(() => pngBytesOfDataUrl("data:image/jpeg;base64,QUJD")).toThrow();
    // PNG 魔数 89 50 4E 47 0D 0A 1A 0A + 'ABC'。
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 65, 66, 67,
    ]).toString("base64");
    expect([
      ...pngBytesOfDataUrl(`data:image/png;base64,${png}`),
    ]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 65, 66, 67]);
    // Android 的 toDataURL 回调只给裸 base64。
    expect([...pngBytesOfDataUrl(png)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 65, 66, 67,
    ]);
    expect(() => pngBytesOfDataUrl("data:image/png;base64,QUJD")).toThrow();
    // RFC 4648 test vectors。
    expect([...base64ToBytes("")]).toEqual([]);
    expect([...base64ToBytes("QQ==")]).toEqual([65]);
    expect([...base64ToBytes("QUJD")]).toEqual([65, 66, 67]);
    expect([...base64ToBytes("QUJDRA==")]).toEqual([65, 66, 67, 68]);
    const arbitrary = [0, 1, 2, 250, 251, 255];
    const encoded = Buffer.from(arbitrary).toString("base64");
    expect([...base64ToBytes(encoded)]).toEqual(arbitrary);
    expect(CARD_WIDTH).toBe(750);
  });
});

describe("series strip layout", () => {
  it("lays out one cell per photo with month labels under each", () => {
    const layout = layoutSeriesStrip([
      { month: "2026-06" },
      { month: "2026-08" },
    ]);
    expect(layout.cells.map((c) => c.month)).toEqual(["2026-06", "2026-08"]);
    const gap = 18;
    const contentW = CARD_WIDTH - 48 * 2;
    const w = (contentW - gap) / 2;
    expect(layout.cells[0]).toMatchObject({
      x: 48,
      w,
      h: 440,
      labelY: layout.cells[0]!.y + 440 + 36,
    });
    expect(layout.cells[1]!.x).toBeCloseTo(48 + w + gap);
    expect(layout.cells[1]!.w).toBeCloseTo(w);
  });
  it("keeps geometry independent of which months are missing", () => {
    const contiguous = layoutSeriesStrip([
      { month: "2026-01" },
      { month: "2026-02" },
      { month: "2026-03" },
    ]);
    const gappy = layoutSeriesStrip([
      { month: "2025-04" },
      { month: "2026-02" },
      { month: "2026-11" },
    ]);
    expect(gappy.cells.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual(
      contiguous.cells.map(({ x, y, w, h }) => ({ x, y, w, h })),
    );
    expect(gappy.height).toBe(contiguous.height);
  });
  it("truncates long series to the cap, keeping both ends", () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `2025-${String((i % 12) + 1).padStart(2, "0")}`,
    }));
    expect(sampledIndices(12, SERIES_STRIP_MAX)).toEqual([0, 4, 7, 11]);
    const layout = layoutSeriesStrip(months);
    expect(layout.cells).toHaveLength(4);
    expect(layout.cells[0]!.month).toBe(months[0]!.month);
    expect(layout.cells[3]!.month).toBe(months[11]!.month);
  });
  it("handles a single photo without dividing by zero", () => {
    const layout = layoutSeriesStrip([{ month: "2026-09" }]);
    expect(layout.cells).toHaveLength(1);
    expect(layout.cells[0]!.w).toBe(CARD_WIDTH - 96);
  });
});
