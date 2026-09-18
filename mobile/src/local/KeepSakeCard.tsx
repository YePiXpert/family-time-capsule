import { forwardRef } from "react";
import Svg, {
  ClipPath,
  Defs,
  Image as SvgImage,
  Line,
  Polygon,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import type { Svg as SvgRef } from "react-native-svg";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as ImageManipulator from "expo-image-manipulator";
import type { LocalMedia, LocalRecord } from "./model";
import { mediaUri } from "./files";
import { dateLabel, paperPalette } from "./ui";
import { buildPdf, pdfPageSlices, type PdfPage } from "./pdf";
import {
  CARD_WIDTH,
  SERIES_STRIP_MAX,
  base64ToBytes,
  layoutKeepSake,
  layoutSeriesStrip,
  pngBytesOfDataUrl,
  pngSize,
  sampledIndices,
  wrapText,
} from "./keepsake";

const {
  ink: INK,
  muted: MUTED,
  accent: ACCENT,
  line: LINE,
  paper: PAPER,
} = paperPalette;

function OrnamentLine({ y }: { y: number }) {
  const midX = CARD_WIDTH / 2;
  const half = 180;
  return (
    <>
      <Line
        x1={midX - half}
        y1={y}
        x2={midX - 22}
        y2={y}
        stroke={LINE}
        strokeWidth={1}
      />
      <Line
        x1={midX + 22}
        y1={y}
        x2={midX + half}
        y2={y}
        stroke={LINE}
        strokeWidth={1}
      />
      <Polygon
        points={`${midX},${y - 4} ${midX + 4},${y} ${midX},${y + 4} ${midX - 4},${y}`}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1}
      />
    </>
  );
}

/** 导出用纪念卡：纸底、细边框、照片、衬线标题正文与装饰线。 */
export const KeepSakeCard = forwardRef<
  SvgRef,
  {
    record: Pick<LocalRecord, "title" | "text" | "date" | "location">;
    profileName: string;
    /** 已降采样的照片与宽高比。 */
    photo?: { uri: string; aspect: number };
  }
>(function KeepSakeCard({ record, profileName, photo }, ref) {
  const layout = layoutKeepSake({
    date: dateLabel(record.date),
    title: record.title.trim() || record.text.trim().split("\n")[0] || "这一刻",
    text: record.title.trim() ? record.text.trim() : record.text.trim().split("\n").slice(1).join("\n").trim(),
    location: record.location,
    photoAspect: photo?.aspect,
  });
  return (
    <Svg
      ref={ref}
      width={layout.width}
      height={layout.height}
      testID="keepsake-card"
    >
      <Rect
        x={0}
        y={0}
        width={layout.width}
        height={layout.height}
        fill={PAPER}
      />
      <Rect
        x={26}
        y={26}
        width={layout.width - 52}
        height={layout.height - 52}
        rx={14}
        fill="none"
        stroke={LINE}
        strokeWidth={1}
      />
      <SvgText
        x={CARD_WIDTH / 2}
        y={layout.dateY}
        fontSize={24}
        fill={MUTED}
        letterSpacing={4}
        textAnchor="middle"
      >
        {dateLabel(record.date)}
      </SvgText>
      <OrnamentLine y={layout.ornamentTopY} />
      {photo && layout.photo && (
        <>
          <Defs>
            <ClipPath id="keepsake-photo">
              <Rect
                x={layout.photo.x}
                y={layout.photo.y}
                width={layout.photo.w}
                height={layout.photo.h}
                rx={12}
              />
            </ClipPath>
          </Defs>
          <SvgImage
            href={photo.uri}
            x={layout.photo.x}
            y={layout.photo.y}
            width={layout.photo.w}
            height={layout.photo.h}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#keepsake-photo)"
          />
        </>
      )}
      {layout.titleLines.map((line, i) => (
        <SvgText
          key={`t${i}`}
          x={CARD_WIDTH / 2}
          y={line.y + 36}
          fontSize={40}
          fontFamily="Georgia, serif"
          fontWeight="600"
          letterSpacing={1}
          fill={INK}
          textAnchor="middle"
        >
          {line.text}
        </SvgText>
      ))}
      {layout.bodyLines.map((line, i) => (
        <SvgText
          key={`b${i}`}
          x={layout.photo ? CARD_WIDTH / 2 : 48 + 6}
          y={line.y + 26}
          fontSize={26}
          fill={INK}
          textAnchor={layout.photo ? "middle" : "start"}
        >
          {line.text}
        </SvgText>
      ))}
      {layout.locationY !== null && (
        <SvgText
          x={CARD_WIDTH / 2}
          y={layout.locationY + 22}
          fontSize={22}
          fill={MUTED}
          textAnchor="middle"
        >
          {record.location}
        </SvgText>
      )}
      <OrnamentLine y={layout.ornamentBottomY} />
      <SvgText
        x={CARD_WIDTH / 2}
        y={layout.footerY}
        fontSize={20}
        fill={MUTED}
        letterSpacing={2}
        textAnchor="middle"
      >
        {`${profileName || "小美"}的成长记`}
      </SvgText>
    </Svg>
  );
});

/** 时光系列对比条：横排照片、月份标签，供离屏导出。 */
export const SeriesStrip = forwardRef<
  SvgRef,
  {
    name: string;
    profileName: string;
    items: { month: string; photo?: { uri: string; aspect: number } }[];
  }
>(function SeriesStrip({ name, profileName, items }, ref) {
  const layout = layoutSeriesStrip(items);
  const picked = sampledIndices(items.length, SERIES_STRIP_MAX).map(
    (i) => items[i]!,
  );
  const title = wrapText(name.trim() || "时光系列", {
    fontSize: 36,
    maxWidth: CARD_WIDTH - 96,
    maxLines: 1,
  })[0]!;
  return (
    <Svg
      ref={ref}
      width={layout.width}
      height={layout.height}
      testID="series-strip"
    >
      <Rect
        x={0}
        y={0}
        width={layout.width}
        height={layout.height}
        fill={PAPER}
      />
      <Rect
        x={26}
        y={26}
        width={layout.width - 52}
        height={layout.height - 52}
        rx={14}
        fill="none"
        stroke={LINE}
        strokeWidth={1}
      />
      <SvgText
        x={CARD_WIDTH / 2}
        y={layout.titleY}
        fontSize={36}
        fontFamily="Georgia, serif"
        fontWeight="600"
        letterSpacing={1}
        fill={INK}
        textAnchor="middle"
      >
        {title}
      </SvgText>
      <OrnamentLine y={layout.ornamentTopY} />
      {layout.cells.map((cell, i) => (
        <SeriesCell
          key={cell.month}
          index={i}
          cell={cell}
          photo={picked[i]?.photo}
        />
      ))}
      <OrnamentLine y={layout.ornamentBottomY} />
      <SvgText
        x={CARD_WIDTH / 2}
        y={layout.footerY}
        fontSize={20}
        fill={MUTED}
        letterSpacing={2}
        textAnchor="middle"
      >
        {`${profileName || "小美"}的成长记`}
      </SvgText>
    </Svg>
  );
});

function SeriesCell({
  index,
  cell,
  photo,
}: {
  index: number;
  cell: ReturnType<typeof layoutSeriesStrip>["cells"][number];
  photo?: { uri: string; aspect: number };
}) {
  return (
    <>
      {photo && (
        <>
          <Defs>
            <ClipPath id={`series-cell-${index}`}>
              <Rect
                x={cell.x}
                y={cell.y}
                width={cell.w}
                height={cell.h}
                rx={10}
              />
            </ClipPath>
          </Defs>
          <SvgImage
            href={photo.uri}
            x={cell.x}
            y={cell.y}
            width={cell.w}
            height={cell.h}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#series-cell-${index})`}
          />
        </>
      )}
      <SvgText
        x={cell.x + cell.w / 2}
        y={cell.labelY}
        fontSize={22}
        fill={MUTED}
        textAnchor="middle"
      >
        {monthLabelOf(cell.month)}
      </SvgText>
    </>
  );
}

function monthLabelOf(key: string) {
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
}

/** 把渲染好的卡片导出为 PNG 文件并呼出系统分享面板。 */
/** 离屏 Svg 取图：两个导出口共用这一段。 */
async function renderPng(svg: SvgRef | null): Promise<Uint8Array> {
  if (!svg) throw new Error("纪念卡尚未就绪，请重试。");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error("纪念卡生成超时，请重试。"));
      settled = true;
    }, 8000);
    svg.toDataURL((url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(url);
    });
  });
  const bytes = pngBytesOfDataUrl(dataUrl);
  if (!bytes.length) throw new Error("纪念卡生成失败，请重试。");
  return bytes;
}
function readAll(file: File): Uint8Array {
  const handle = file.open(FileMode.ReadOnly);
  try {
    const out = new Uint8Array(file.size);
    let at = 0;
    while (at < out.length) {
      const chunk = handle.readBytes(Math.min(262144, out.length - at));
      if (!chunk.length) throw new Error("成长册生成失败，请重试。");
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  } finally {
    handle.close();
  }
}
/**
 * 把长卷切成 A4 比例的若干页，逐页嵌进一份 PDF。本机生成，不走网络，也不新增依赖。
 */
export async function exportYearBookPdf(
  svg: SvgRef | null,
  name: string,
): Promise<File> {
  const bytes = await renderPng(svg);
  const { width, height } = pngSize(bytes);
  const directory = new Directory(Paths.cache, "keepsake");
  directory.create({ intermediates: true, idempotent: true });
  const source = new File(directory, `${name}.png`);
  source.write(bytes);
  const pageHeight = Math.max(1, Math.round((width * 842) / 595));
  const pages: PdfPage[] = [];
  try {
    for (const slice of pdfPageSlices(height, pageHeight)) {
      const page = await ImageManipulator.manipulateAsync(
        source.uri,
        [{ crop: { originX: 0, originY: slice.originY, width, height: slice.height } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      const cropped = new File(page.uri);
      pages.push({
        jpeg: readAll(cropped),
        width: page.width,
        height: page.height,
      });
      try {
        cropped.delete();
      } catch {
        // 系统缓存目录的清理尽力而为。
      }
    }
  } finally {
    try {
      source.delete();
    } catch {
      // 同上。
    }
  }
  const out = new File(directory, `${name}.pdf`);
  out.write(buildPdf(pages));
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("此设备暂不支持分享成长册。");
  await Sharing.shareAsync(out.uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: "保存或打印这本成长册",
  });
  return out;
}
export async function exportKeepSakeCard(
  svg: SvgRef | null,
  recordId: string,
): Promise<File> {
  const bytes = await renderPng(svg);
  const directory = new Directory(Paths.cache, "keepsake");
  directory.create({ intermediates: true, idempotent: true });
  const out = new File(directory, `${recordId}.png`);
  out.write(bytes);
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("此设备暂不支持分享纪念卡。");
  await Sharing.shareAsync(out.uri, {
    mimeType: "image/png",
    UTI: "public.png",
    dialogTitle: "保存或分享这张纪念卡",
  });
  return out;
}

/** 纪念卡用照片：降采样到指定宽（默认 1080），返回临时文件与宽高比。 */
export async function prepareKeepSakePhoto(
  media: LocalMedia | undefined,
  width = 1080,
) {
  if (media?.kind !== "image") return undefined;
  const result = await ImageManipulator.manipulateAsync(
    mediaUri(media),
    [{ resize: { width } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );
  const aspect = result.width / Math.max(result.height, 1);
  return { uri: result.uri, aspect };
}

export { base64ToBytes };
