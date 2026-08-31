import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { asset as assetTable } from "@/db/schema/asset";
import { assetAnalysis } from "@/db/schema/analysis";
import { getAssetStorage } from "@/lib/assets/storage";
import { extractVideoFrames, type ExtractedFrame } from "@/lib/media/ffmpeg";
import { probeMedia } from "@/lib/metadata/ffprobe";
import { AiJobHandlerError, type AiJobHandler } from "@/jobs/types";

/**
 * Production handler for `analyze.asset_video.v1`（M3-G 视频理解）。
 *
 * - 绝不把整段视频送给模型：ffmpeg 抽少量代表帧（内存中的临时输入，
 *   有总字节上限），逐帧走 vision provider，再汇总为一行 analysis；
 * - ffmpeg 不可用（本地无二进制）→ 优雅降级为非重试失败，
 *   原件与其余功能不受影响；
 * - 结果是可重建 derivative：不进入 portable archive（除非用户基于其
 *   确认了 Fact，届时 FactSource 的 asset_analysis 引用指向 durable 的
 *   asset id，quote 固化在 fact_source 行内）。
 */

const MAX_FRAMES = 6;
const MAX_DESCRIPTION_CHARS = 4_000;
const MAX_OCR_CHARS = 2_000;

const FRAME_PROMPT = `请客观分析这个视频帧（它是同一段家庭视频的采样画面之一），并严格按以下两部分输出（不要添加其他章节）：

【描述】
只描述画面中直接可见的内容（人物、物体、场景、文字、颜色、构图等）。禁止推测情绪、关系、身份或画面中没有的信息。保持简洁。

【图中文字】
转录画面中所有清晰可见的文字。如果没有可见文字，留空。

【描述】

【图中文字】
`;

type FrameAnalysis = { description: string; ocrText: string | null };

function parseFrameText(text: string): FrameAnalysis {
  const startDesc = text.indexOf("【描述】");
  const startOcr = text.indexOf("【图中文字】");
  if (startDesc === -1 || startOcr === -1 || startOcr <= startDesc) {
    return { description: text.trim(), ocrText: null };
  }
  const description = text.slice(startDesc + "【描述】".length, startOcr).trim();
  const ocr = text.slice(startOcr + "【图中文字】".length).trim();
  return {
    description: description.length > 0 ? description : text.trim(),
    ocrText: ocr.length > 0 ? ocr : null,
  };
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export type VideoAnalysisDependencies = {
  /** 帧提取（测试注入）；缺省走 lib/media/ffmpeg 的真实实现 */
  extractFrames?: (
    absPath: string,
    options: { durationSeconds: number | null; maxFrames?: number },
  ) => Promise<
    | { status: "ok"; frames: ExtractedFrame[] }
    | { status: "unavailable" }
    | { status: "failed" }
  >;
  /** 时长探测（测试注入）；缺省走 ffprobe */
  probe?: (absPath: string) => Promise<{ durationMs: number | null } | null>;
};

export function createAnalyzeAssetVideoHandler(
  deps: VideoAnalysisDependencies = {},
): AiJobHandler {
  const extractFrames = deps.extractFrames ?? extractVideoFrames;
  const probe = deps.probe ?? probeMedia;

  return async ({ lease, assistant, signal }) => {
    const db = getDb();
    const asset = db
      .select()
      .from(assetTable)
      .where(
        and(
          eq(assetTable.id, lease.entityId),
          eq(assetTable.familyId, lease.familyId),
        ),
      )
      .limit(1)
      .get();

    if (!asset) {
      throw new AiJobHandlerError("asset_not_found", false);
    }
    if (asset.originalAssetId !== null) {
      throw new AiJobHandlerError("derivative_not_analyzable", false);
    }
    if (asset.type !== "video") {
      throw new AiJobHandlerError("unsupported_asset_type", false);
    }

    const storage = getAssetStorage();
    const absPath = storage.resolvePath(asset.storageKey);

    let durationSeconds: number | null =
      asset.durationMs !== null ? asset.durationMs / 1000 : null;
    if (durationSeconds === null) {
      const probed = await probe(absPath);
      durationSeconds = probed?.durationMs != null ? probed.durationMs / 1000 : null;
    }

    const extraction = await extractFrames(absPath, {
      durationSeconds,
      maxFrames: MAX_FRAMES,
    });
    if (extraction.status === "unavailable") {
      // ffmpeg 缺失：视频分析优雅不可用，不重试、不影响原件
      throw new AiJobHandlerError("ffmpeg_unavailable", false);
    }
    if (extraction.status === "failed" || extraction.frames.length === 0) {
      throw new AiJobHandlerError("frame_extraction_failed", false);
    }

    // 逐帧 vision 分析（帧是临时输入，分析完即弃）
    const frameResults: { atSeconds: number; analysis: FrameAnalysis }[] = [];
    let provenance: { providerId: string; model: string } | null = null;
    for (const frame of extraction.frames) {
      const result = await assistant.analyzeImage({
        image: { bytes: frame.bytes, mimeType: "image/jpeg" },
        prompt: FRAME_PROMPT,
        signal,
      });
      provenance = {
        providerId: result.provenance.providerId,
        model: result.provenance.model,
      };
      frameResults.push({ atSeconds: frame.atSeconds, analysis: parseFrameText(result.text) });
    }

    const descriptionParts = frameResults.map(
      (f) => `[${formatClock(f.atSeconds)}] ${f.analysis.description}`,
    );
    const description = `由 ${frameResults.length} 个代表帧的视觉描述汇总（AI 生成 · 未确认）：\n${descriptionParts.join("\n")}`;
    const ocrTexts = frameResults
      .map((f) => f.analysis.ocrText)
      .filter((t): t is string => Boolean(t));
    const ocrText =
      ocrTexts.length > 0 ? ocrTexts.join("\n").slice(0, MAX_OCR_CHARS) : null;

    return {
      commit: (tx) => {
        const now = new Date();
        tx.insert(assetAnalysis)
          .values({
            id: randomUUID(),
            familyId: lease.familyId,
            assetId: asset.id,
            description: description.slice(0, MAX_DESCRIPTION_CHARS),
            ocrText,
            provider: provenance!.providerId,
            model: provenance!.model,
            sourceSha256: asset.sha256,
            analyzedVia: "video_frames",
            createdByJobId: lease.jobId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: assetAnalysis.assetId,
            set: {
              description: description.slice(0, MAX_DESCRIPTION_CHARS),
              ocrText,
              provider: provenance!.providerId,
              model: provenance!.model,
              sourceSha256: asset.sha256,
              analyzedVia: "video_frames",
              createdByJobId: lease.jobId,
              updatedAt: now,
            },
          })
          .run();
      },
    };
  };
}

export const analyzeAssetVideoHandler = createAnalyzeAssetVideoHandler();
