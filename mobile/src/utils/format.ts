export function dateLabel(value: string, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function inputDateTime(wallTime: string | null): string {
  return wallTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(wallTime)
    ? wallTime.slice(0, 16)
    : "";
}
