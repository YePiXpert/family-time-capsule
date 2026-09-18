/**
 * 装订台：一页一页把纯排版取成图，再流式写成 PDF。
 * 年度册与（下一轮的）相册册共用这一套，页面只负责给 BookInput 和一张 key→素材 的表。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { Svg as SvgRef } from "react-native-svg";
import { File } from "expo-file-system";
import { BookPageCard } from "./BookPage";
import {
  layoutBook,
  slotPixels,
  softPhotoCount,
  type BookInput,
  type BookLayout,
} from "./book";
import {
  captureBookPage,
  captureGeometry,
  discardBoundPages,
  prepareBookPhoto,
  shareBook,
  writeBookPdf,
  type BoundPage,
} from "./book-export";
import type { LocalMedia, Stored } from "./model";
import { messageOf } from "./ui";

/** 屏外舞台的点数：iOS 按舞台自身尺寸画图，所以它就是成品尺寸（见 captureGeometry）。 */
const STAGE_PT = captureGeometry().stage;

export type BookJob = {
  layout: BookLayout;
  /** 导出文件名（不含扩展名）。 */
  name: string;
  title: string;
  /** 版面里的 photo key → 本机素材。 */
  media: Record<string, Stored<LocalMedia> | undefined>;
};

export function useBookBinder() {
  const [job, setJob] = useState<BookJob | null>(null);
  const [index, setIndex] = useState(0);
  const [staged, setStaged] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const svg = useRef<SvgRef | null>(null);
  const bound = useRef<BoundPage[]>([]);
  const scratch = useRef<string[]>([]);
  /** 每张照片实际出图的尺寸；取图时顺手记下，收尾时用来算清晰度预警。 */
  const sizes = useRef<Record<string, { width: number; height: number }>>({});
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const cleanup = useCallback(() => {
    for (const uri of scratch.current)
      try {
        const file = new File(uri);
        if (file.exists) file.delete();
      } catch {
        // 缓存清理尽力而为。
      }
    scratch.current = [];
  }, []);

  const stop = useCallback(() => {
    cleanup();
    discardBoundPages(bound.current);
    bound.current = [];
    setJob(null);
    setStaged(null);
    setIndex(0);
  }, [cleanup]);

  const start = useCallback(
    (next: BookJob) => {
      bound.current = [];
      scratch.current = [];
      sizes.current = {};
      setError("");
      setNotice("");
      setIndex(0);
      setStaged(null);
      setJob(next);
    },
    [],
  );

  // 一步：给这一页备好照片。只备这一页要用的，备完就挂上去渲染。
  useEffect(() => {
    if (!job || staged) return;
    const page = job.layout.pages[index];
    if (!page) return;
    let cancelled = false;
    void (async () => {
      try {
        const keys = [
          ...new Set(
            page.elements.flatMap((e) => (e.kind === "photo" ? [e.key] : [])),
          ),
        ];
        const prepared: Record<string, string> = {};
        for (const key of keys) {
          const photo = await prepareBookPhoto(job.media[key], slotPixels(page, key));
          if (photo) {
            prepared[key] = photo.uri;
            scratch.current.push(photo.uri);
            sizes.current[key] = { width: photo.width, height: photo.height };
          }
        }
        if (cancelled || !alive.current) return;
        setStaged(prepared);
      } catch (e) {
        if (!cancelled) {
          setError(messageOf(e));
          stop();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job, index, staged, stop]);

  // 二步：两帧之后取图，落成缓存里的 JPEG，然后翻到下一页；最后一页收尾成 PDF。
  useEffect(() => {
    if (!job || !staged) return;
    let cancelled = false;
    const first = requestAnimationFrame(() =>
      requestAnimationFrame(async () => {
        if (cancelled || !alive.current) return;
        try {
          bound.current.push(await captureBookPage(svg.current, index));
          cleanup();
          if (cancelled || !alive.current) return;
          if (index + 1 < job.layout.pages.length) {
            setStaged(null);
            setIndex(index + 1);
            return;
          }
          const file = writeBookPdf(bound.current, job.name, job.title);
          // 出图从不放大，所以实际出图尺寸够不够 150 DPI，就等于原图够不够。
          const soft = softPhotoCount(job.layout, sizes.current);
          if (soft)
            setNotice(
              `有 ${soft} 张照片的原图撑不满版位，印出来会偏软；其余按 300 DPI 出图。`,
            );
          await shareBook(file);
          stop();
        } catch (e) {
          if (cancelled) return;
          setError(messageOf(e));
          stop();
        }
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(first);
    };
  }, [job, staged, index, cleanup, stop]);

  return {
    /** 有值就说明正在装订。 */
    job,
    error,
    setError,
    /** 装订完成后的提醒（例如清晰度预警），不是失败。 */
    notice,
    setNotice,
    progress: job ? { done: index, total: job.layout.pages.length } : null,
    start,
    cancel: stop,
    /** 放在页面里：装订时把当前这一页挂到屏幕外渲染。 */
    stage:
      job && staged ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: -10000, top: 0, opacity: 0 }}
        >
          <BookPageCard
            ref={svg}
            page={job.layout.pages[index]!}
            photos={staged}
            points={STAGE_PT}
          />
        </View>
      ) : null,
  };
}

/** 页面把 BookInput 交过来，这里负责算版面。 */
export const planBook = (input: BookInput) => layoutBook(input);
