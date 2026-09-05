import { randomUUID } from "node:crypto";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import {
  getCollection,
  saveCollection,
  setCollectionDeleted,
  CollectionError,
} from "@/lib/collections/service";
import {
  asRecord,
  mobileJson,
  readMobileJson,
  mobileRequestError,
} from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
type Route = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Route) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    return mobileJson(getCollection(auth.context, (await params).id));
  } catch (error) {
    return error instanceof CollectionError
      ? mobileJson({ error: error.code }, { status: error.status })
      : mobileRequestError(error);
  }
}
export async function PATCH(request: Request, { params }: Route) {
  if (!isSameOrigin(request))
    return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "event:write");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request, 2 * 1024 * 1024));
    if (Object.hasOwn(body, "familyId"))
      throw new CollectionError("family_id_not_accepted");
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1)
      throw new CollectionError("invalid_revision");
    const id = (await params).id,
      revision = Number(body.revision);
    if (body.operation === "delete" || body.operation === "restore")
      return mobileJson(
        setCollectionDeleted(
          auth.context,
          id,
          revision,
          body.operation === "delete",
        ),
      );
    if (body.operation === "add") {
      if (
        !Array.isArray(body.eventIds) ||
        body.eventIds.length > 100 ||
        body.eventIds.some((e) => typeof e !== "string")
      )
        throw new CollectionError("invalid_sources");
      const current = getCollection(auth.context, id);
      const seen = new Set(current.items.map((i) => i.memoryEventId));
      const added = (body.eventIds as string[])
        .filter((eventId) => {
          if (seen.has(eventId)) return false;
          seen.add(eventId);
          return true;
        })
        .map((memoryEventId) => ({
          id: randomUUID(),
          memoryEventId,
          sectionId: null,
          caption: "",
        }));
      return mobileJson(
        saveCollection(auth.context, id, revision, {
          ...current,
          items: [...current.items, ...added],
        }),
      );
    }
    if (body.operation !== "save")
      throw new CollectionError("invalid_operation");
    return mobileJson(saveCollection(auth.context, id, revision, body.edit));
  } catch (error) {
    return error instanceof CollectionError
      ? mobileJson({ error: error.code }, { status: error.status })
      : mobileRequestError(error);
  }
}
