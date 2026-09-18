/**
 * 成册导出的管线：一页一页取图，落成缓存里的 JPEG，再流式写进一份 PDF。
 *
 * 为什么一页一页来：一张 300 DPI 的方页是 2433×2433，位图本身就二十多 MB，
 * 整本几十页全堆在内存里必然炸。这里任何时刻只有一页的字节活着，
 * PDF 也是边写边落盘，不先拼成一个大 Uint8Array。
 */
import { PixelRatio, Platform } from "react-native";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import {
  ImageManipulator as Images,
  SaveFormat,
  type ImageRef,
} from "expo-image-manipulator";
import * as Sharing from "expo-sharing";
import type { Svg as SvgRef } from "react-native-svg";
import { SHEET_PT, SHEET_PX } from "./book";
import { pngBytesOfDataUrl } from "./keepsake";
import { mediaUri } from "./files";
import type { LocalMedia, Stored } from "./model";
import { writePdf, type PdfPageSource } from "./pdf";

const CAPTURE_TIMEOUT_MS = 20000;
/** 页面 JPEG 的质量：再高体积翻倍，印出来看不出来。 */
const PAGE_QUALITY = 0.82;
/** 版位照片的质量：它还要再进一次整页 JPEG，这一道压得轻一点。 */
const PHOTO_QUALITY = 0.9;

export type BoundPage = { file: File; width: number; height: number };

const workspace = () => {
  const directory = new Directory(Paths.cache, "book");
  directory.create({ intermediates: true, idempotent: true });
  return directory;
};

function readAll(file: File): Uint8Array {
  const handle = file.open(FileMode.ReadOnly);
  try {
    const out = new Uint8Array(file.size);
    let at = 0;
    while (at < out.length) {
      const chunk = handle.readBytes(Math.min(262144, out.length - at));
      if (!chunk.length) throw new Error("成册生成失败，请重试。");
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  } finally {
    handle.close();
  }
}

/**
 * 两个平台对 toDataURL 的尺寸理解不一样，必须分别换算：
 * 安卓 `Bitmap.createBitmap(w,h)` 要的就是像素；iOS 的 `UIGraphicsImageRenderer`
 * 按点建画布再乘屏幕倍率，直接传 2433 会渲成 7299² 的位图，当场 OOM。
 */
function captureRequest(pixels: number) {
  const scale = Platform.OS === "ios" ? PixelRatio.get() : 1;
  // iOS 原生把点数取整，向上取整才保证不低于目标像素。
  return Math.ceil(pixels / scale);
}

/** 取一页：显式给 toDataURL 尺寸，成品分辨率因此与设备像素比无关。 */
export async function captureBookPage(
  svg: SvgRef | null,
  index: number,
  pixels = SHEET_PX,
): Promise<BoundPage> {
  if (!svg) throw new Error("这一页还没准备好，请重试。");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error("成册生成超时，请重试。"));
      settled = true;
    }, CAPTURE_TIMEOUT_MS);
    const side = captureRequest(pixels);
    svg.toDataURL(
      (url: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(url);
      },
      { width: side, height: side },
    );
  });
  const directory = workspace();
  const png = new File(directory, `page-${index}.png`);
  png.write(pngBytesOfDataUrl(dataUrl));
  try {
    // PNG 转 JPEG：同样的画面，体积小一个数量级，印刷看不出差别。
    const jpeg = await ImageManipulator.manipulateAsync(png.uri, [], {
      compress: PAGE_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const source = new File(jpeg.uri);
    const kept = new File(directory, `page-${index}.jpg`);
    await source.copy(kept, { overwrite: true });
    try {
      source.delete();
    } catch {
      // 系统缓存目录的清理尽力而为。
    }
    return { file: kept, width: jpeg.width, height: jpeg.height };
  } finally {
    try {
      png.delete();
    } catch {
      // 同上。
    }
  }
}

/** 把取好的页流式写成一份 PDF；页面尺寸固定，页与页之间不差半毫米。 */
export function writeBookPdf(
  pages: BoundPage[],
  name: string,
  title: string,
): File {
  const out = new File(workspace(), `${name}.pdf`);
  if (out.exists) out.delete();
  out.create();
  const handle = out.open(FileMode.WriteOnly);
  try {
    const sources: PdfPageSource[] = pages.map((page) => ({
      width: page.width,
      height: page.height,
      read: () => readAll(page.file),
    }));
    writePdf(sources, (bytes) => handle.writeBytes(bytes), {
      box: { width: SHEET_PT, height: SHEET_PT },
      title,
    });
  } finally {
    handle.close();
  }
  return out;
}

export function discardBoundPages(pages: BoundPage[]): void {
  for (const page of pages)
    try {
      if (page.file.exists) page.file.delete();
    } catch {
      // 缓存清理尽力而为。
    }
}

export async function shareBook(file: File): Promise<void> {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("此设备暂不支持分享纪念册。");
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: "保存或送印这本纪念册",
  });
}

/** 原生图对象用完就放，否则整本册子会攒下几十张解码后的位图。 */
function drop(ref: ImageRef) {
  try {
    ref.release();
  } catch {
    // 放不掉就交给 GC。
  }
}

/**
 * 按版位取图：目标像素照版位算，且绝不超过原图——放大只会更糊。
 *
 * 不能拿 media.width/height 当原图尺寸：那是 512 宽缩略图的尺寸（`files.ts` 的
 * renderThumb），照它算会把每张照片都压到 512，整本册子直接没了分辨率。
 * 所以先 renderAsync 拿真实尺寸，再决定缩不缩。
 */
export async function prepareBookPhoto(
  media: Stored<LocalMedia> | LocalMedia | undefined,
  longestPx: number,
): Promise<{ uri: string; width: number; height: number } | undefined> {
  if (media?.kind !== "image") return undefined;
  const context = Images.manipulate(mediaUri(media as LocalMedia));
  const source = await context.renderAsync();
  try {
    const longest = Math.max(source.width, source.height);
    const target = Math.min(longest, longestPx);
    const rendered =
      target < longest
        ? await context
            .resize(
              source.width >= source.height
                ? { width: target }
                : { height: target },
            )
            .renderAsync()
        : source;
    try {
      const saved = await rendered.saveAsync({
        compress: PHOTO_QUALITY,
        format: SaveFormat.JPEG,
      });
      return { uri: saved.uri, width: saved.width, height: saved.height };
    } finally {
      if (rendered !== source) drop(rendered);
    }
  } finally {
    drop(source);
  }
}
