export function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function inputDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

export function ageLabel(ageDays: number | null): string | null {
  if (ageDays === null || ageDays < 0) return null;
  if (ageDays < 31) return `出生第 ${ageDays + 1} 天`;
  if (ageDays < 730) return `${Math.floor(ageDays / 30.4375)} 个月`;
  const years = Math.floor(ageDays / 365.2425);
  const months = Math.floor((ageDays - years * 365.2425) / 30.4375);
  return `${years} 岁${months > 0 ? ` ${months} 个月` : ""}`;
}
