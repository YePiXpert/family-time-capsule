import { revalidatePath } from "next/cache";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { enableAiProcessingConsent, getAiOperationalStatus, revokeAiProcessingConsent } from "@/lib/ai/jobs";
import { asRecord, mobileJson, mobileRequestError, readMobileJson } from "@/lib/mobile/http";

export async function GET(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "ai:review");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  const status = getAiOperationalStatus(authorization.context);
  return status ? mobileJson(status) : mobileJson({ error: "forbidden" }, { status: 403 });
}

export async function POST(request: Request) {
  const authorization = await authorizeApiFamilyRequest(request.headers, "ai:configure");
  if (!authorization.ok) return mobileJson({ error: authorization.error }, { status: authorization.status });
  try {
    const input = asRecord(await readMobileJson(request, 4096));
    if (!["text", "vision", "transcription"].includes(String(input.capability)) || !["enable", "disable"].includes(String(input.operation))) return mobileJson({ error: "invalid_input" }, { status: 400 });
    const capability = input.capability as "text" | "vision" | "transcription";
    const result = input.operation === "disable"
      ? revokeAiProcessingConsent(authorization.context, capability)
      : enableAiProcessingConsent(authorization.context, { capability, configurationId: typeof input.configurationId === "string" ? input.configurationId : "", allowAutomaticFamilyContent: false });
    if (!result.ok) return mobileJson({ error: result.error }, { status: result.error === "forbidden" ? 403 : 409 });
    revalidatePath("/settings/ai");
    return mobileJson(getAiOperationalStatus(authorization.context));
  } catch (error) { return mobileRequestError(error); }
}
