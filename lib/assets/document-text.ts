/** Bounded inert UTF-8 derivative; validation continues beyond the preview limit. */
export function documentTextCollector(mime: string) {
  const decoder = ["text/plain", "text/markdown"].includes(mime)
    ? new TextDecoder("utf-8", { fatal: true }) : null;
  const limit = 256 * 1024;
  let text = "";
  let invalid = false;
  let bytes = 0;
  const append = (value: string) => { text += value.slice(0, Math.max(0, limit - text.length)); };
  return {
    write(chunk: Uint8Array) {
      bytes += chunk.byteLength;
      if (!decoder || invalid) return;
      if (chunk.includes(0)) { invalid = true; return; }
      try { append(decoder.decode(chunk, { stream: true })); } catch { invalid = true; }
    },
    finish() {
      if (decoder && !invalid) {
        try { append(decoder.decode()); } catch { invalid = true; }
      }
      // Never retain half a surrogate pair at the bounded preview boundary.
      if (/[\uD800-\uDBFF]$/u.test(text)) text = text.slice(0, -1);
      return { text: decoder && !invalid ? text : null, invalid,
        truncated: bytes > Buffer.byteLength(text, "utf8") };
    },
  };
}
