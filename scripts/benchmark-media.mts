import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import sharp from "sharp";
import { convertMedia } from "../lib/media/convert";
import type { AssetRow } from "../lib/assets/service";
const dir = await mkdtemp(path.join(tmpdir(), "ftc-media-benchmark-"));
const report: {
  mode: string;
  nodePeakSampledRssBytes: number;
  ffmpegPeakSampledRssBytes: number;
  browser: string;
  cases: {
    kind: string;
    inputBytes: number;
    outputBytes: number;
    elapsedMs: number;
  }[];
} = {
  mode: "actual file conversion; no mocked throughput",
  nodePeakSampledRssBytes: 0,
  ffmpegPeakSampledRssBytes: 0,
  browser: "not measured by this benchmark",
  cases: [],
};
let running = false;
const sample = () => {
  if (running) return;
  running = true;
  try {
    report.nodePeakSampledRssBytes = Math.max(
      report.nodePeakSampledRssBytes,
      process.memoryUsage().rss,
    );
    const children = execFileSync(
      "ps",
      ["--ppid", String(process.pid), "-o", "comm=,rss="],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter((line) => line.trim().startsWith("ffmpeg"))
      .reduce(
        (sum, line) => sum + Number(line.trim().split(/\s+/)[1] || 0) * 1024,
        0,
      );
    report.ffmpegPeakSampledRssBytes = Math.max(
      report.ffmpegPeakSampledRssBytes,
      children,
    );
  } finally {
    running = false;
  }
};
try {
  const picture = path.join(dir, "fictional.jpg"),
    video = path.join(dir, "fictional.mp4");
  await sharp({
    create: { width: 6000, height: 4000, channels: 3, background: "#b3a38a" },
  })
    .jpeg()
    .toFile(picture);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1920x1080:rate=24:duration=8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=8",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-shortest",
        video,
      ],
      { stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("fixture generation failed")),
    );
  });
  sample();
  const timer = setInterval(sample, 20);
  try {
    for (const [kind, type, mimeType, input] of [
      ["preview", "image", "image/jpeg", picture],
      ["preview", "video", "video/mp4", video],
      ["waveform", "video", "video/mp4", video],
      ["transcode", "video", "video/mp4", video],
    ] as const) {
      const output = path.join(dir, `${type}-${kind}`),
        start = performance.now();
      await convertMedia({ type, mimeType } as AssetRow, kind, input, output);
      report.cases.push({
        kind: `${type}-${kind}`,
        inputBytes: (await stat(input)).size,
        outputBytes: (await stat(output)).size,
        elapsedMs: Math.round(performance.now() - start),
      });
    }
  } finally {
    clearInterval(timer);
    sample();
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(dir, { recursive: true, force: true });
}
