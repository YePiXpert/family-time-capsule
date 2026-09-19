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
import {
  YEARBOOK_WIDTH,
  layoutYearbook,
  type YearbookInput,
} from "./yearbook";
import { paperPalette, serif } from "./ui";
import { CHILD_FALLBACK } from "./brand";

const {
  ink: INK,
  muted: MUTED,
  accent: ACCENT,
  line: LINE,
  paper: PAPER,
  emptyCell: EMPTY_CELL,
} = paperPalette;
const PADDING_X = 48 + 6;

export type YearbookPhoto = { uri: string; aspect: number };

function OrnamentLine({ y }: { y: number }) {
  const midX = YEARBOOK_WIDTH / 2;
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

function Heading({ y, text }: { y: number; text: string }) {
  return (
    <SvgText
      x={YEARBOOK_WIDTH / 2}
      y={y + 20}
      fontSize={24}
      fontFamily={serif}
      letterSpacing={3}
      fill={MUTED}
      textAnchor="middle"
    >
      {text}
    </SvgText>
  );
}

/** 导出用年度成长册长卷：封面、寄语、十二月网格、第一次与落款。 */
export const YearBookCard = forwardRef<
  SvgRef,
  {
    input: YearbookInput;
    photos: { cover?: YearbookPhoto; months: (YearbookPhoto | undefined)[] };
    profileName: string;
  }
>(function YearBookCard({ input, photos, profileName }, ref) {
  const layout = layoutYearbook(input);
  const monthPhotos = input.months.map(
    (_, index) => photos.months[index] ?? undefined,
  );
  return (
    <Svg
      ref={ref}
      width={layout.width}
      height={layout.height}
      testID="yearbook-sheet"
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
      <Circle
        cx={layout.stamp.cx}
        cy={layout.stamp.cy}
        r={layout.stamp.r}
        fill="none"
        stroke={ACCENT}
        strokeWidth={2}
      />
      <Circle
        cx={layout.stamp.cx}
        cy={layout.stamp.cy}
        r={layout.stamp.r - 6}
        fill="none"
        stroke={ACCENT}
        strokeWidth={0.5}
        opacity={0.5}
      />
      <SvgText
        x={layout.stamp.cx}
        y={layout.stamp.cy + 14}
        fontSize={40}
        fontFamily={serif}
        fontWeight="600"
        letterSpacing={1}
        fill={ACCENT}
        textAnchor="middle"
      >
        {input.year}
      </SvgText>
      {layout.titleLines.map((line, i) => (
        <SvgText
          key={`t${i}`}
          x={YEARBOOK_WIDTH / 2}
          y={line.y}
          fontSize={40}
          fontFamily={serif}
          fontWeight="600"
          letterSpacing={1}
          fill={INK}
          textAnchor="middle"
        >
          {line.text}
        </SvgText>
      ))}
      {layout.statsY !== null && (
        <SvgText
          x={YEARBOOK_WIDTH / 2}
          y={layout.statsY}
          fontSize={22}
          fill={MUTED}
          textAnchor="middle"
        >
          {input.stats}
        </SvgText>
      )}
      {photos.cover && layout.coverPhoto && (
        <>
          <Defs>
            <ClipPath id="yearbook-cover">
              <Rect
                x={layout.coverPhoto.x}
                y={layout.coverPhoto.y}
                width={layout.coverPhoto.w}
                height={layout.coverPhoto.h}
                rx={12}
              />
            </ClipPath>
          </Defs>
          <SvgImage
            href={photos.cover.uri}
            x={layout.coverPhoto.x}
            y={layout.coverPhoto.y}
            width={layout.coverPhoto.w}
            height={layout.coverPhoto.h}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#yearbook-cover)"
          />
        </>
      )}
      {layout.ornaments.map((y, i) => (
        <OrnamentLine key={`o${i}`} y={y} />
      ))}
      {layout.noteHeadingY !== null && (
        <Heading y={layout.noteHeadingY} text="爸爸妈妈的话" />
      )}
      {layout.noteLines.map((line, i) => (
        <SvgText
          key={`n${i}`}
          x={YEARBOOK_WIDTH / 2}
          y={line.y}
          fontSize={24}
          fill={INK}
          textAnchor="middle"
        >
          {line.text}
        </SvgText>
      ))}
      {layout.monthsHeadingY !== null && (
        <Heading y={layout.monthsHeadingY} text="这一年的十二个月" />
      )}
      {layout.cells.map((cell, index) => {
        const photo = monthPhotos[index];
        return (
          <Fragment key={`m${index}`}>
            {photo ? (
              <>
                <Defs>
                  <ClipPath id={`yearbook-month-${index}`}>
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
                  clipPath={`url(#yearbook-month-${index})`}
                />
              </>
            ) : (
              <>
                <Rect
                  x={cell.x}
                  y={cell.y}
                  width={cell.w}
                  height={cell.h}
                  rx={10}
                  fill={EMPTY_CELL}
                  stroke={LINE}
                  strokeWidth={1}
                />
                <SvgText
                  x={cell.x + cell.w / 2}
                  y={cell.y + cell.h / 2 + 6}
                  fontSize={20}
                  fill={MUTED}
                  textAnchor="middle"
                >
                  {cell.label}
                </SvgText>
              </>
            )}
            {photo && (
              <SvgText
                x={cell.x + cell.w / 2}
                y={cell.labelY}
                fontSize={20}
                fill={INK}
                textAnchor="middle"
              >
                {cell.label}
              </SvgText>
            )}
            {cell.count > 0 && (
              <SvgText
                x={cell.x + cell.w / 2}
                y={cell.countY}
                fontSize={18}
                fill={MUTED}
                textAnchor="middle"
              >
                {`${cell.count} 段时光`}
              </SvgText>
            )}
          </Fragment>
        );
      })}
      {layout.firstsHeadingY !== null && (
        <Heading y={layout.firstsHeadingY} text="这一年的第一次" />
      )}
      {layout.firsts.map((entry, i) => (
        <Fragment key={`f${i}`}>
          <SvgText
            x={PADDING_X}
            y={entry.y}
            fontSize={24}
            fill={MUTED}
          >
            {entry.date}
          </SvgText>
          <SvgText
            x={PADDING_X}
            y={entry.y + 30}
            fontSize={28}
            fontFamily={serif}
            fontWeight="600"
            fill={INK}
          >
            {entry.title}
          </SvgText>
        </Fragment>
      ))}
      <SvgText
        x={YEARBOOK_WIDTH / 2}
        y={layout.colophonY}
        fontSize={20}
        fill={MUTED}
        letterSpacing={2}
        textAnchor="middle"
      >
        {`${profileName || CHILD_FALLBACK}的成长记 · ${input.colophon}`}
      </SvgText>
    </Svg>
  );
});

