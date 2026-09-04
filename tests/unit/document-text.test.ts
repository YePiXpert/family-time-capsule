import { describe, expect, it } from "vitest";
import { documentTextCollector } from "@/lib/assets/document-text";

describe("bounded document text", () => {
  it("decodes split UTF-8 without interpreting Markdown or HTML", () => {
    const collector = documentTextCollector("text/markdown");
    const bytes = Buffer.from("外婆 <script>alert(1)</script>");
    for (const byte of bytes) collector.write(Uint8Array.of(byte));
    expect(collector.finish()).toEqual({ text: bytes.toString(), invalid: false, truncated: false });
  });
  it("continues validating past the bounded preview", () => {
    for (const invalid of [Buffer.from([0]), Buffer.from([255]), Buffer.from([0xe4])]) {
      const collector = documentTextCollector("text/plain");
      collector.write(Buffer.alloc(300_000, 65));
      collector.write(invalid);
      expect(collector.finish()).toMatchObject({ text: null, invalid: true });
    }
  });
  it("bounds text without splitting a surrogate and ignores other MIME types", () => {
    const collector = documentTextCollector("text/plain");
    collector.write(Buffer.from("a".repeat(256 * 1024 - 1) + "😀tail"));
    expect(collector.finish()).toEqual({ text: "a".repeat(256 * 1024 - 1), invalid: false, truncated: true });
    for (const mime of ["application/pdf", "application/rtf", "text/html", "image/svg+xml"]) {
      const binary = documentTextCollector(mime);
      binary.write(Buffer.from("never index this"));
      expect(binary.finish().text).toBeNull();
    }
  });
});
