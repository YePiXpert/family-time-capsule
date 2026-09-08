import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { AiConfigurationError } from "./errors";
import type { AiEnvironment } from "./config";

export function isPublicAiAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    const [first, second] = normalized.split(":").slice(0,2).map(part => parseInt(part || "0",16));
    // Accept global unicast only; mapped/translated, local and transition ranges
    // require an explicit operator-approved base URL as well.
    return first >= 0x2000 && first < 0x3fff && first !== 0x2002 && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
  }
  return false;
}

function allowedPrivate(baseUrl: string, env: AiEnvironment) {
  const raw = env.AI_ALLOWED_PRIVATE_TARGETS ?? "";
  if (raw.length > 8192) throw new AiConfigurationError("AI_ALLOWED_PRIVATE_TARGETS is too long.","AI_ALLOWED_PRIVATE_TARGETS");
  return raw.split(",").filter(Boolean).some(value => {
    try {
      const approved = new URL(value.trim());
      if (approved.protocol !== "https:" || approved.username || approved.password || approved.search || approved.hash) return false;
      return approved.href.replace(/\/$/,"") === baseUrl;
    } catch { return false; }
  });
}

/** Resolve/validate and encode before quota reservation. The returned sender is
 * synchronous until request.end: it uses the checked address, original TLS name,
 * and never follows redirects. https://nodejs.org/api/https.html#httpsrequesturl-options-callback */
export async function prepareAiFetch(url: string, init: RequestInit, baseUrl: string, env: AiEnvironment, resolve = lookup): Promise<() => Promise<Response>> {
  const target = new URL(url), base = new URL(baseUrl);
  if (target.origin !== base.origin || !target.pathname.startsWith(`${base.pathname.replace(/\/$/,"")}/`)) throw new AiConfigurationError("AI request target does not match the configured recipient.");
  const host = target.hostname.replace(/^\[|\]$/g,"");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host, { all: true, verbatim: true });
  const namedLoopback = host === "localhost" || host.endsWith(".localhost");
  const loopbackAddress = (address: string) => isIP(address) === 4 ? address.startsWith("127.") : isIP(address) === 6 && new URL(`http://[${address}]`).hostname === "[::1]";
  const explicitLoopback = namedLoopback || loopbackAddress(host);
  if (!addresses.length || (explicitLoopback && addresses.some(row => !loopbackAddress(row.address))) || (!explicitLoopback && !allowedPrivate(baseUrl,env) && addresses.some(row => !isPublicAiAddress(row.address)))) throw new AiConfigurationError("AI recipient resolves to an unapproved private or reserved address.","AI_ALLOWED_PRIVATE_TARGETS");
  const selected = addresses.find(row => row.family === 4) ?? addresses[0];
  const encoded = new Request(url, init);
  const bytes = Buffer.from(await encoded.arrayBuffer());
  const headers = Object.fromEntries(encoded.headers);
  headers["content-length"] = String(bytes.length);
  return () => new Promise((resolveResponse,reject) => {
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(target, {
      method: encoded.method, headers, agent: false, signal: init.signal ?? undefined,
      family: selected.family,
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    }, response => {
      try {
        const status = response.statusCode ?? 502;
        if (status < 200 || status > 599) throw new Error("AI upstream returned an invalid HTTP status.");
        if (status >= 300 && status < 400) throw new Error("AI redirects are forbidden.");
        const responseHeaders = new Headers();
        for (let n = 0; n < response.rawHeaders.length; n += 2) responseHeaders.append(response.rawHeaders[n],response.rawHeaders[n+1]);
        resolveResponse(new Response([204,205,304].includes(status) ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }));
      } catch (error) {
        response.destroy();
        reject(error);
      }
    });
    request.on("error",reject);
    request.end(bytes);
  });
}
