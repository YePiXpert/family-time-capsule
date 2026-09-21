import { Fragment, forwardRef } from "react";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Image as SvgImage,
  Line,
  Polygon,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import type { Svg as SvgRef } from "react-native-svg";
import { BLEED_PT, SHEET_PT, TRIM_PT, type BookPage as Page } from "./book";
import { paperPalette, serif } from "./ui";

const {
  ink: INK,
  muted: MUTED,
  accent: ACCENT,
  line: LINE,
  paper: PAPER,
} = paperPalette;
const SERIF = serif;
const MIDDLE = BLEED_PT + TRIM_PT / 2;

function Ornament({ y }: { y: number }) {
  const half = TRIM_PT * 0.26;
  return (
    <>
      <Line x1={MIDDLE - half} y1={y} x2={MIDDLE - 8} y2={y} stroke={LINE} strokeWidth={0.6} />
      <Line x1={MIDDLE + 8} y1={y} x2={MIDDLE + half} y2={y} stroke={LINE} strokeWidth={0.6} />
      <Polygon
        points={`${MIDDLE},${y - 2.4} ${MIDDLE + 2.4},${y} ${MIDDLE},${y + 2.4} ${MIDDLE - 2.4},${y}`}
        fill="none"
        stroke={ACCENT}
        strokeWidth={0.6}
      />
    </>
  );
}

/**
 * 一页纸的离屏渲染。坐标全部来自 book.ts 的纯排版，这里只管画。
 * `points` 是这张舞台的点数：iOS 按它决定成品像素，安卓只看 toDataURL 的入参，
 * 两边的换算都在 book-export.ts 的 captureGeometry 里。
 */
export const BookPageCard = forwardRef<
  SvgRef,
  { page: Page; photos: Record<string, string>; points: number }
>(function BookPageCard({ page, photos, points }, ref) {
  return (
    <Svg
      ref={ref}
      width={points}
      height={points}
      viewBox={`0 0 ${SHEET_PT} ${SHEET_PT}`}
    >
      <Defs>
        {page.elements.map((element, index) =>
          element.kind === "photo" ? (
            <ClipPath id={`clip${index}`} key={`clip${index}`}>
              <Rect
                x={element.x}
                y={element.y}
                width={element.w}
                height={element.h}
                rx={page.fullBleed ? 0 : 3}
              />
            </ClipPath>
          ) : null,
        )}
      </Defs>
      {!page.fullBleed && (
        <Rect x={0} y={0} width={SHEET_PT} height={SHEET_PT} fill={PAPER} />
      )}
      {page.elements.map((element, index) => {
        if (element.kind === "photo") {
          const href = photos[element.key];
          if (!href)
            return (
              <Rect
                key={index}
                x={element.x}
                y={element.y}
                width={element.w}
                height={element.h}
                rx={3}
                fill={LINE}
              />
            );
          return (
            <SvgImage
              key={index}
              x={element.x}
              y={element.y}
              width={element.w}
              height={element.h}
              href={{ uri: href }}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#clip${index})`}
            />
          );
        }
        if (element.kind === "scrim")
          return (
            <Rect
              key={index}
              x={0}
              y={element.y}
              width={SHEET_PT}
              height={element.h}
              fill={PAPER}
              opacity={0.9}
            />
          );
        if (element.kind === "ornament") return <Ornament key={index} y={element.y} />;
        if (element.kind === "rule")
          return (
            <Line
              key={index}
              x1={BLEED_PT + TRIM_PT * 0.06}
              y1={element.y}
              x2={BLEED_PT + TRIM_PT * 0.94}
              y2={element.y}
              stroke={LINE}
              strokeWidth={0.5}
            />
          );
        if (element.kind === "stamp")
          return (
            <Fragment key={index}>
              <Circle
                cx={element.cx}
                cy={element.cy}
                r={element.r}
                fill="none"
                stroke={ACCENT}
                strokeWidth={1.2}
              />
              <Circle
                cx={element.cx}
                cy={element.cy}
                r={element.r - 4}
                fill="none"
                stroke={ACCENT}
                strokeWidth={0.6}
              />
              <SvgText
                x={element.cx}
                y={element.cy + element.r * 0.22}
                fontSize={element.r * 0.6}
                fontFamily={SERIF}
                fill={ACCENT}
                textAnchor="middle"
              >
                {element.text}
              </SvgText>
            </Fragment>
          );
        return (
          <SvgText
            key={index}
            x={element.x}
            y={element.y}
            fontSize={element.size}
            fontFamily={element.serif ? SERIF : undefined}
            fill={
              element.tone === "muted"
                ? MUTED
                : element.tone === "accent"
                  ? ACCENT
                  : INK
            }
            textAnchor={
              element.align === "center"
                ? "middle"
                : element.align === "right"
                  ? "end"
                  : "start"
            }
          >
            {element.text}
          </SvgText>
        );
      })}
    </Svg>
  );
});
