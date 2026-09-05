import { getDb } from "@/db";
import { assetTranscript } from "@/db/schema/transcript";
import { and, eq } from "drizzle-orm";
import { parseReaderSegments } from "@/mobile/src/media/types";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import {
  asRecord,
  mobileJson,
  readMobileJson,
  mobileRequestError,
} from "@/lib/mobile/http";
import { isSameOrigin } from "@/lib/security/origin";
import {
  getMediaDerivations,
  requestMediaDerivation,
  MediaJobError,
} from "@/lib/media/jobs";
import type { MediaDerivationKind } from "@/lib/media/convert";
async function handle(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  if (request.method === "POST" && !isSameOrigin(request))
    return mobileJson({ error: "forbidden" }, { status: 403 });
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const { assetId } = await params;
    if (request.method === "POST") {
      const body = asRecord(await readMobileJson(request));
      if (Object.hasOwn(body, "familyId"))
        return mobileJson({ error: "family_id_not_accepted" }, { status: 400 });
      requestMediaDerivation(
        auth.context,
        assetId,
        body.kind as MediaDerivationKind,
      );
    }
    const jobs = getMediaDerivations(auth.context, assetId);
    const transcript = getDb()
      .select()
      .from(assetTranscript)
      .where(
        and(
          eq(assetTranscript.assetId, assetId),
          eq(assetTranscript.familyId, auth.context.familyId),
        ),
      )
      .get();
    return mobileJson({
      jobs,
      transcript: transcript
        ? {
            text: transcript.editedTranscript ?? transcript.rawTranscript,
            edited: transcript.editedTranscript !== null,
            segments: parseReaderSegments(transcript.segmentsJson),
          }
        : null,
    });
  } catch (error) {
    return error instanceof MediaJobError
      ? mobileJson({ error: error.code }, { status: error.status })
      : mobileRequestError(error);
  }
}
export const GET = handle;
export const POST = handle;
