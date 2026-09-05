import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { mobileJson } from "@/lib/mobile/http";
import { getCalendarMonth, getBrowsePage } from "@/lib/memories/calendar";
import { listPeople } from "@/lib/family/service";
import { ageLocations } from "@/mobile/src/utils/calendar";

export async function GET(request: Request) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  const params = new URL(request.url).searchParams;
  if (params.has("familyId"))
    return mobileJson({ error: "family_id_not_accepted" }, { status: 400 });
  try {
    const month = params.get("month") ?? "";
    const date = params.get("date");
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(`${month}-`))
    )
      throw new Error("invalid_date");
    const filters = {
      person: params.get("person") || undefined,
      media: params.get("media") || undefined,
      tag: params.get("tag") || undefined,
    };
    const [calendar, page, people] = await Promise.all([
      getCalendarMonth(auth.context, month, filters),
      getBrowsePage(auth.context, date || month, filters, params.get("cursor")),
      listPeople(auth.context.familyId),
    ]);
    const child = people.find((person) => person.isChild && person.birthDate);
    return mobileJson({
      ...calendar,
      ...page,
      people: people.map((p) => ({ id: p.id, name: p.displayName })),
      ages: child?.birthDate ? ageLocations(child.birthDate) : [],
    });
  } catch {
    return mobileJson({ error: "invalid_calendar_query" }, { status: 400 });
  }
}
