import { afterAll, describe, expect, it } from "vitest";

const { extractVideoFrames, samplePoints, resetFfmpegUnavailableCacheForTests } =
  await import("@/lib/media/ffmpeg");

const originalPath = process.env.FFMPEG_PATH;
afterAll(() => {
  if (originalPath === undefined) delete process.env.FFMPEG_PATH;
  else process.env.FFMPEG_PATH = originalPath;
  resetFfmpegUnavailableCacheForTests();
});

describe("M3-G：ffmpeg 抽帧", () => {
  it("短视频 3 帧、长视频 6 帧、采样点避开首尾死区", () => {
    expect(samplePoints(10)).toHaveLength(3);
    expect(samplePoints(120)).toHaveLength(6);

    const points = samplePoints(60);
    expect(points[0]).toBeGreaterThanOrEqual(0.5);
    expect(points[points.length - 1]).toBeLessThanOrEqual(59.5);
    // 均匀分布：相邻间隔一致
    const gaps = points.slice(1).map((p, i) => p - points[i]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);

    expect(samplePoints(null)).toEqual([0]);
    expect(samplePoints(0)).toEqual([0]);
  });

  it("ffmpeg 缺失 → unavailable（优雅降级 + 结果缓存）", async () => {
    process.env.FFMPEG_PATH = "definitely-not-a-real-ffmpeg-binary";
    resetFfmpegUnavailableCacheForTests();
    const result = await extractVideoFrames("no-such-file.mp4", {
      durationSeconds: 10,
    });
    expect(result).toEqual({ status: "unavailable" });
  });
});
