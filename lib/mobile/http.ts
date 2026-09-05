import "server-only";

import { zonedWallTimeToUtc } from "@/lib/metadata/time";

const MAX_JSON_BYTES = 64 * 1024;

export function mobileJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

export async function readMobileJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new MobileRequestError("invalid_content_type", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MobileRequestError("invalid_json", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new MobileRequestError("too_large", 413);
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new MobileRequestError("invalid_json", 400);
  }
}

export class MobileRequestError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "MobileRequestError";
  }
}

export function mobileRequestError(error: unknown): Response {
  return error instanceof MobileRequestError
    ? mobileJson({ error: error.code }, { status: error.status })
    : mobileJson({ error: "invalid_input" }, { status: 400 });
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MobileRequestError("invalid_input", 400);
  }
  return value as Record<string, unknown>;
}

export function optionalString(
  record: Record<string, unknown>,
  key: string,
  max: number,
): string | null | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max) {
    throw new MobileRequestError("invalid_input", 400);
  }
  return value;
}

export function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  maxItems = 50,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string" || item.length > 128)) {
    throw new MobileRequestError("invalid_input", 400);
  }
  return value as string[];
}

export function optionalDate(
  record: Record<string, unknown>,
  key: string,
): Date | null | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new MobileRequestError("invalid_input", 400);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new MobileRequestError("invalid_input", 400);
  return date;
}

export function optionalFamilyWallDate(
  record: Record<string, unknown>,
  key: string,
  timeZone: string,
): Date | null | undefined {
  const value = optionalString(record, key, 19);
  if (value === undefined || value === null) return value;
  try {
    return zonedWallTimeToUtc(value.length === 16 ? `${value}:00` : value, timeZone);
  } catch {
    throw new MobileRequestError("invalid_input", 400);
  }
}
