import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { defaultBookLayout, type BookDetail } from "../mobile/src/books/types";
import type { RenderInput } from "../lib/books/render/types";
const dir = await mkdtemp(path.join(tmpdir(), "ftc-real-book-benchmark-"));
let nodeRssPeak = process.memoryUsage().rss;
async function run(args: string[], program = process.execPath) {
  const start = performance.now(),
    child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "",
    stderr = "",
    rssPeak = 0,
    measuring = false;
  child.stdout.on("data", (b) => {
    stdout += b.toString();
  });
  child.stderr.on("data", (b) => {
    stderr += b.toString();
  });
  const timer = setInterval(() => {
    nodeRssPeak = Math.max(nodeRssPeak, process.memoryUsage().rss);
    if (!child.pid || measuring) return;
    measuring = true;
    void readFile(`/proc/${child.pid}/status`, "utf8")
      .then((text) => {
        const value = /^VmRSS:\s+(\d+) kB/m.exec(text);
        if (value) rssPeak = Math.max(rssPeak, Number(value[1]) * 1024);
      })
      .catch(() => {})
      .finally(() => {
        measuring = false;
      });
  }, 20);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (code !== 0)
      throw new Error(stderr || stdout || "benchmark child failed");
    return {
      elapsedMs: Math.round(performance.now() - start),
      sampledRssPeakBytes: rssPeak,
    };
  } finally {
    clearInterval(timer);
  }
}
try {
  const original = path.join(dir, "fictional-original.jpg");
  await sharp(
    Buffer.from(
      '<svg width="5000" height="3600"><rect width="5000" height="3600" fill="#e7cfa8"/><circle cx="1800" cy="1700" r="1400" fill="#799b88"/><rect x="3300" y="600" width="700" height="2500" fill="#b76752"/></svg>',
    ),
  )
    .jpeg({ quality: 95 })
    .toFile(original);
  const hash = async () => {
    const h = createHash("sha256");
    for await (const b of createReadStream(original)) h.update(b);
    return h.digest("hex");
  };
  const before = await hash(),
    assetId = randomUUID(),
    sourceId = randomUUID(),
    chapterId = randomUUID();
  const size = (await stat(original)).size;
  const book: BookDetail = {
    id: randomUUID(),
    title: "虚构家庭出版性能样本",
    subtitle: "真实原件读取与排版测量",
    template: "growth",
    audience: "family",
    pageSize: "A5",
    startDate: null,
    endDate: null,
    coverAssetId: assetId,
    revision: 1,
    ownerPersonId: null,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    canWrite: true,
    timezone: "Asia/Shanghai",
    chapters: [{ id: chapterId, title: "六十封虚构家书" }],
    blocks: Array.from({ length: 60 }, (_, i) => ({
      id: randomUUID(),
      chapterId,
      kind: "image",
      text: `第${i + 1}封虚构家书，中文与 Mixed English 一起排版。我们在窗边读信。`,
      caption: "由程序绘制的虚构图案",
      layout: {
        ...defaultBookLayout(),
        breakBefore: true,
        fit: i % 2 ? "cover" : "contain",
      },
      sourceIds: [sourceId],
    })),
    sources: [
      {
        id: sourceId,
        kind: "asset",
        assetId,
        memoryEventId: null,
        contributionId: null,
        storyId: null,
        collectionId: null,
        fingerprint: before,
        label: "虚构图案原件",
      },
    ],
    sourceStates: {
      [sourceId]: {
        available: true,
        changed: false,
        label: "虚构图案原件",
        occurredAt: null,
        ageLabel: null,
        author: null,
        asset: {
          id: assetId,
          filename: "fictional-original.jpg",
          mimeType: "image/jpeg",
          type: "image",
          width: 5000,
          height: 3600,
          bytes: size,
          previewAssetId: null,
        },
      },
    },
    blockedBlockIds: [],
    warnings: [],
    versions: [],
  };
  const input: RenderInput = {
    book,
    images: {
      [assetId]: { path: original, bytes: size, width: 5000, height: 3600 },
    },
    fontPath: path.join(
      process.cwd(),
      "resources/fonts/NotoSansCJKsc-Regular.otf",
    ),
    format: "pdf",
  };
  const rows = [];
  for (const format of ["pdf", "epub"] as const) {
    input.format = format;
    const json = path.join(dir, "input.json"),
      output = path.join(dir, `output.${format}`);
    await writeFile(json, JSON.stringify(input));
    const result = await run([
      "--max-old-space-size=384",
      "--import",
      "tsx",
      "--conditions=react-server",
      "scripts/render-book.mts",
      json,
      output,
    ]);
    rows.push({ format, ...result, outputBytes: (await stat(output)).size });
  }
  const poppler = await run(
    [
      "-f",
      "1",
      "-l",
      "62",
      "-r",
      "72",
      "-png",
      path.join(dir, "output.pdf"),
      path.join(dir, "page"),
    ],
    "pdftoppm",
  );
  const result = {
    fixture: "60-page fictional image/text editing payload; 5000x3600 original",
    originalBytes: size,
    originalShaUnchanged: before === (await hash()),
    renderer: rows,
    nodeSampledRssPeakBytes: nodeRssPeak,
    poppler,
    browserResourceMeasurement: null,
    ffmpegResourceMeasurement: null,
    measurement:
      "Actual streamed SHA reads, original-to-layout sharp conversions, PDF/EPUB output, and Poppler page rasterization. Linux /proc RSS sampled at 20ms, not an OS hard peak or mocked throughput.",
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await rm(dir, { recursive: true, force: true });
}
