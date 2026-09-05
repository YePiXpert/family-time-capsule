import {
  addCalendarDays,
  addCalendarMonths,
  parseCalendarDate,
} from "../utils/calendar";
import type { BookAudience, BookTemplate } from "./types";
export type BookReviewRange = { startDate: string; endDate: string };
export function bookReviewRange(key: string): BookReviewRange {
  if (/^\d{4}$/.test(key)) {
    const startDate = `${key}-01-01`;
    parseCalendarDate(startDate);
    return {
      startDate,
      endDate: addCalendarDays(addCalendarMonths(startDate, 12), -1),
    };
  }
  if (/^\d{4}-\d{2}$/.test(key)) {
    const startDate = `${key}-01`;
    parseCalendarDate(startDate);
    return {
      startDate,
      endDate: addCalendarDays(addCalendarMonths(startDate, 1), -1),
    };
  }
  throw new Error("invalid_period");
}
export function earlyBookRanges(birthDate: string) {
  parseCalendarDate(birthDate);
  return [
    {
      label: "出生第一周",
      startDate: birthDate,
      endDate: addCalendarDays(birthDate, 6),
    },
    {
      label: "出生第一个月",
      startDate: birthDate,
      endDate: addCalendarDays(addCalendarMonths(birthDate, 1), -1),
    },
    {
      label: "出生前百天",
      startDate: addCalendarDays(birthDate, -100),
      endDate: addCalendarDays(birthDate, -1),
    },
    {
      label: "出生一百天",
      startDate: birthDate,
      endDate: addCalendarDays(birthDate, 99),
    },
  ];
}
export type BookReviewKind = "memory" | "story" | "contribution";
export type BookReviewMaterial = {
  id: string;
  kind: BookReviewKind;
  title: string;
  date: string;
  selected: boolean;
  included: boolean;
  milestone: string | null;
  author: string | null;
};
export type BookReview = BookReviewRange & {
  periodId: string;
  timezone: string;
  birthDate: string | null;
  total: number;
  selectedCount: number;
  months: { month: string; count: number }[];
  materials: BookReviewMaterial[];
  nextCursor: string | null;
  draft: {
    id: string;
    title: string;
    revision: number;
    newMemoryCount: number;
  } | null;
  audience: BookAudience;
  template: BookTemplate;
  canWrite: boolean;
};
