import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server, type RequestListener } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryAssistant } from "@/lib/ai/server";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });

async function listen(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server missing");
  return `http://127.0.0.1:${address.port}`;
}

function assistant(base: string) {
  return createMemoryAssistant({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: base, AI_API_KEY: "dedicated-loopback-test", AI_MODEL: "test-text", AI_VISION_MODEL: "test-vision", AI_TRANSCRIPTION_MODEL: "test-speech" }, { execution: { kind: "diagnostic", operationId: randomUUID() } });
}

describe("real loopback HTTP, deterministic provider; no external model requests", () => {
  it("sends independent text, data-image and multipart audio requests through real fetch", async () => {
    const received: Array<{ path: string; contentType: string; body: string }> = [];
    const base = await listen(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8");
      received.push({ path: req.url!, contentType: String(req.headers["content-type"]), body });
      expect(req.headers.authorization).toBe("Bearer dedicated-loopback-test");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/v1/audio/transcriptions" ? { text: "hello family" } : { choices: [{ message: { content: '{"title":"窗边的绿萝"}' }, finish_reason: "stop" }] }));
    });
    const provider = assistant(base);
    expect((await provider.generateText({ messages: [{ role: "user", content: "Return a JSON title" }], responseFormat: "json" })).text).toBe('{"title":"窗边的绿萝"}');
    await provider.analyzeImage({ image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }, prompt: "Describe shapes" });
    expect(await provider.transcribeAudio({ audio: { bytes: readFileSync("tests/fixtures/sample.wav"), mimeType: "audio/wav", fileName: "PRIVATE_ORIGINAL.wav" } })).toMatchObject({ text: "hello family", segments: [] });
    expect(received.map(call => call.path)).toEqual(["/v1/chat/completions", "/v1/chat/completions", "/v1/audio/transcriptions"]);
    expect(JSON.parse(received[1].body).messages[0].content[1].image_url.url).toBe("data:image/png;base64,AQID");
    expect(received[2].contentType).toContain("multipart/form-data; boundary=");
    expect(received[2].body).toContain('filename="audio.wav"');
    expect(received[2].body).not.toContain("PRIVATE_ORIGINAL");
  });

  it("never follows a redirect or sends Authorization to its destination", async () => {
    let targetCalls = 0;
    const target = await listen((_req, res) => { targetCalls++; res.end("unexpected"); });
    const base = await listen((_req, res) => { res.writeHead(307, { location: `${target}/collect` }); res.end(); });
    await expect(assistant(base).generateText({ messages: [{ role: "user", content: "test" }] })).rejects.toMatchObject({ code: "ai_network_error" });
    expect(targetCalls).toBe(0);
  });

  it("preserves Retry-After without returning an untrusted non-JSON error body", async () => {
    const base = await listen((_req, res) => { res.writeHead(429, { "retry-after": "120", "content-type": "text/html" }); res.end("PRIVATE_PROVIDER_ERROR"); });
    await expect(assistant(base).generateText({ messages: [{ role: "user", content: "test" }] })).rejects.toMatchObject({ code: "ai_provider_http_error", retryAfterMs: 120_000, retryable: true, message: "AI provider returned HTTP 429." });
  });
});
