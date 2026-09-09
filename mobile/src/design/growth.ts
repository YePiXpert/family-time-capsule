import { calendarAge, calendarDate, parseCalendarDate } from "../utils/calendar";

type ChildProfile = { id: string; displayName: string; isChild: boolean; birthDate: string | null };

/** Only use an unambiguous child profile. Never guess a birthday or use fixture data. */
export function growthHeading(people: readonly ChildProfile[], at: Date, timezone: string) {
  const children = people.filter(person => person.isChild);
  const child = children.find(person => person.displayName.trim() === "小美") ?? (children.length === 1 ? children[0] : undefined);
  const title = child ? `${child.displayName}成长记` : children.length > 1 ? "孩子们的成长记" : "小美成长记";
  let age: string | null = null;
  if (child?.birthDate) {
    try {
      const today = calendarDate(at, timezone);
      const days = Math.round((parseCalendarDate(today).getTime() - parseCalendarDate(child.birthDate).getTime()) / 86_400_000);
      if (days === 0) age = "今天，与你初次见面";
      else if (days > 0) {
        const value = calendarAge(child.birthDate, today);
        age = value.years > 0 ? `${value.years} 岁${value.months ? ` ${value.months} 个月` : ""}`
          : value.months > 0 ? `${value.months} 个月${value.days ? ` ${value.days} 天` : ""}` : `出生 ${days} 天`;
      }
    } catch { /* A missing or invalid profile must not invent an age. */ }
  }
  return { title, age, childName: child?.displayName ?? "小美", childId: child?.id ?? null };
}
