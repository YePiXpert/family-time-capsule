import { zonedWallTimeToUtc } from "@/lib/metadata/time";
import {
  addCalendarDays,
  addCalendarMonths,
  parseCalendarDate,
} from "@/mobile/src/utils/calendar";

/** All archive date filters use a family-local [from, before) interval. */
export function calendarRange(key: string, timeZone: string) {
  const start =
    key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key;
  parseCalendarDate(start);
  const end =
    key.length === 4
      ? addCalendarMonths(start, 12)
      : key.length === 7
        ? addCalendarMonths(start, 1)
        : addCalendarDays(start, 1);
  return {
    from: zonedWallTimeToUtc(`${start}T00:00:00`, timeZone),
    before: zonedWallTimeToUtc(`${end}T00:00:00`, timeZone),
  };
}
