import { DraftError } from "./service";
import { mobileJson, mobileRequestError } from "@/lib/mobile/http";
export function draftResponseError(error: unknown): Response {
  if (error instanceof DraftError) return mobileJson({ error: error.code }, { status: error.status });
  return mobileRequestError(error);
}
