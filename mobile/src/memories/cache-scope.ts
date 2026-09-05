import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Credentials } from "../types";

/** Include the session so a newly connected account cannot use a stale viewer
 * snapshot to read the previous account's cache. Never persist the bearer token. */
export function memoryCacheScope(
  credentials: Credentials | null,
  userId: string | undefined,
  familyId: string | undefined,
): string | null {
  if (!credentials) return null;
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([
    credentials.serverUrl.replace(/\/+$/, ""), credentials.token, userId, familyId,
  ]))));
}
