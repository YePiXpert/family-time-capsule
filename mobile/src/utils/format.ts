/** §6：precision 存在时按精度显示，绝不泄露虚假日期；缺省按到日显示（历史调用）。 */
export function dateLabel(value: string, timeZone?: string, precision?: string): string {
  if (precision === "unknown") return "时间不确定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (precision === "year") {
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(date) + "年";
  }
  if (precision === "month") {
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", ...(timeZone ? { timeZone } : {}) }).format(date);
  }
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
