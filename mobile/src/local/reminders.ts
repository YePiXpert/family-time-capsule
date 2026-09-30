import type { Library } from "./model";
import { parseBirthday } from "./dates";
export type Reminder = { id: string; date: Date; title: string; body: string };
export function importantDays(state: Library, now = new Date()): Reminder[] {
  const days = new Map<string, Reminder>();
  const add = (id: string, date: Date, body: string) => {
    if (!Number.isFinite(date.getTime()) || date <= now) return;
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (!days.has(key)) days.set(key, { id, date, title: "成长记", body });
  };
  const born = parseBirthday(state.profile.birthday);
  if (born)
    for (let year = now.getFullYear(); year <= now.getFullYear() + 3; year++) {
      if (year <= born.getFullYear()) continue;
      const day = Math.min(
        born.getDate(),
        new Date(year, born.getMonth() + 1, 0).getDate(),
      );
      add(
        `birthday-${year}`,
        new Date(year, born.getMonth(), day, 9),
        "今天是孩子的生日，留几句话给她吧。",
      );
    }
  for (const letter of Object.values(state.letters))
    if (letter.sealed && !letter.openedAt && letter.visibility !== "family")
      add(
        `letter-${letter.id}`,
        new Date(`${letter.openAt}T09:00:00`),
        "一封写给未来的信，到了约定拆开的日子。",
      );
  return [...days.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 48);
}
