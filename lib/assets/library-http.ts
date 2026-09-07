import { AssetLibraryError } from "./library";
import { DraftError } from "@/lib/drafts/service";
import { CollectionError } from "@/lib/collections/service";
import { mobileJson, mobileRequestError } from "@/lib/mobile/http";
export function libraryError(error: unknown) {
  return error instanceof AssetLibraryError || error instanceof DraftError || error instanceof CollectionError ? mobileJson({ error: error.code }, { status: error.status }) : mobileRequestError(error);
}
