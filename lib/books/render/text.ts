/** Fail on missing glyphs instead of silently producing an unreadable PDF. */
export function checkedPdfText(pdf: PDFKit.PDFDocument) {
  const font = (
    pdf as unknown as {
      _font: { font: { hasGlyphForCodePoint: (n: number) => boolean } };
    }
  )._font.font;
  return (text: string) => {
    const value = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    for (const ch of value) {
      if (ch === "\n") continue;
      const cp = ch.codePointAt(0)!;
      if (cp < 32 || !font.hasGlyphForCodePoint(cp))
        throw new Error(`unsupported_glyph_U${cp.toString(16).toUpperCase()}`);
    }
    return value;
  };
}
