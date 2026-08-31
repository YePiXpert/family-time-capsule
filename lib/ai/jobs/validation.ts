const SAFE_CODE = /^[a-z0-9_:-]{1,64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_TYPE = /^[a-z][a-z0-9_.:-]{0,99}$/u;
const OPAQUE_ID = /^[A-Za-z0-9_.:@-]{1,256}$/u;

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

export function isSafeOperationalCode(value: unknown): value is string {
  return typeof value === "string" && SAFE_CODE.test(value);
}

export function isSafeJobType(value: unknown): value is string {
  return typeof value === "string" && SAFE_TYPE.test(value);
}

export function isOpaqueEntityId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID.test(value);
}

export function isSafeProviderLabel(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
