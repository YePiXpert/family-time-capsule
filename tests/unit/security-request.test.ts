import { describe, expect, it } from "vitest";
import {
  MULTIPART_OVERHEAD_BYTES,
  isSameOrigin,
  requestBodySizeError,
} from "@/lib/security/origin";

function request(headers: Record<string, string>) {
  return new Request("http://internal:3000/upload", { headers });
}

describe("HTTP mutation request boundaries", () => {
  it("accepts the direct host and trusted forwarded host", () => {
    expect(
      isSameOrigin(request({ host: "archive.example", origin: "https://archive.example" })),
    ).toBe(true);
    expect(
      isSameOrigin(
        request({
          host: "internal:3000",
          "x-forwarded-host": "archive.example",
          origin: "https://archive.example",
        }),
      ),
    ).toBe(true);
  });

  it("rejects cross-site fetch metadata, malformed origins, and host mismatch", () => {
    expect(isSameOrigin(request({ host: "archive.example", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(request({ host: "archive.example", origin: "not a URL" }))).toBe(false);
    expect(
      isSameOrigin(request({ host: "archive.example", origin: "https://evil.example" })),
    ).toBe(false);
  });

  it("requires a finite body length and leaves room only for multipart metadata", () => {
    const max = 1_000;
    expect(requestBodySizeError(request({}), max)).toBe("length_required");
    expect(requestBodySizeError(request({ "content-length": "chunked" }), max)).toBe(
      "length_required",
    );
    expect(requestBodySizeError(request({ "content-length": "0" }), max)).toBe(
      "length_required",
    );
    expect(
      requestBodySizeError(
        request({ "content-length": String(max + MULTIPART_OVERHEAD_BYTES) }),
        max,
      ),
    ).toBeNull();
    expect(
      requestBodySizeError(
        request({ "content-length": String(max + MULTIPART_OVERHEAD_BYTES + 1) }),
        max,
      ),
    ).toBe("too_large");
  });
});
