import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { chooseIntake } from "@/lib/imports/intake";
import { draftResponseError } from "@/lib/drafts/http";
import { asRecord, mobileJson, readMobileJson } from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "capture:create");
  if (!auth.ok) return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const body = asRecord(await readMobileJson(request));
    return mobileJson(chooseIntake(auth.context, (await params).id, {
      destination: body.destination as "draft" | "library", revision: body.revision as number,
      draftId: body.draftId as string | undefined, draftRevision: body.draftRevision as number | undefined,
      mutationId: body.mutationId as string,
      recordOnly: body.operation === "record",
    }));
  } catch (error) { return draftResponseError(error); }
}
