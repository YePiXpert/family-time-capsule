/** 某一时刻（UTC ms）在指定 IANA 时区的偏移（毫秒） */
function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  });
  const part = dtf.formatToParts(instant).find((p) => p.type === "timeZoneName");
  const name = part?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0; // "GMT" 无偏移
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

/**
 * 把「时区内的墙钟时间」折算成 UTC 时刻。DST 重复小时稳定选择较早时刻；
 * DST 跳时产生的不存在墙钟值会被拒绝，避免悄悄漂移到另一小时。
 */
export function zonedWallTimeToUtc(
  wallTime: string, // YYYY-MM-DDTHH:mm:ss
  timeZone: string,
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(
    wallTime,
  );
  if (!match) {
    throw new Error(`invalid wall time: ${wallTime}`);
  }
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw = "00"] = match;
  const parts = {
    year: Number(yearRaw),
    month: Number(monthRaw),
    day: Number(dayRaw),
    hour: Number(hourRaw),
    minute: Number(minuteRaw),
    second: Number(secondRaw),
  };
  const asUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const normalized = new Date(asUtcMs);
  if (
    normalized.getUTCFullYear() !== parts.year ||
    normalized.getUTCMonth() + 1 !== parts.month ||
    normalized.getUTCDate() !== parts.day ||
    normalized.getUTCHours() !== parts.hour ||
    normalized.getUTCMinutes() !== parts.minute ||
    normalized.getUTCSeconds() !== parts.second
  ) {
    throw new Error(`invalid wall time: ${wallTime}`);
  }

  // A wall time can be close to a DST transition. Discover every offset in a
  // wide window, then retain only instants that round-trip to the exact input.
  // A spring-forward gap has no candidate; a fall-back overlap has two and we
  // deliberately choose the earlier instant for a stable contract.
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 3) {
    offsets.add(timezoneOffsetMs(new Date(asUtcMs + hours * 3_600_000), timeZone));
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const candidates = [...offsets]
    .map((offset) => new Date(asUtcMs - offset))
    .filter((candidate) => {
      const candidateParts = formatter.formatToParts(candidate);
      const value = (type: Intl.DateTimeFormatPartTypes) =>
        Number(candidateParts.find((part) => part.type === type)?.value);
      return (
        value("year") === parts.year &&
        value("month") === parts.month &&
        value("day") === parts.day &&
        value("hour") === parts.hour &&
        value("minute") === parts.minute &&
        value("second") === parts.second
      );
    })
    .sort((a, b) => a.getTime() - b.getTime());
  if (!candidates[0]) throw new Error(`invalid wall time: ${wallTime}`);
  return candidates[0];
}

/** 形如 +08:00 的偏移字符串 → 分钟数；非法返回 null */
export function parseOffsetMinutes(offset: string): number | null {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  if (Number(m[2]) > 14 || Number(m[3]) > 59) return null;
  return m[1] === "-" ? -minutes : minutes;
}

/** UTC 时刻 → 指定时区的 datetime-local 值（YYYY-MM-DDTHH:mm，供输入框默认值） */
export function utcToZonedWallTimeInput(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

