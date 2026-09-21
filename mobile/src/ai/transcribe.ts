import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { serverPrecheck } from "../local/transcribe";
import { AIError, upload } from "./client";

export async function transcribeOnServer(
  input: { uri: string; seconds?: number },
  signal?: AbortSignal,
): Promise<string> {
  const checkCanceled = () => {
    if (signal?.aborted) throw new AIError("CANCELED", "已停止等待，草稿不变。");
  };
  checkCanceled();
  const file = new File(input.uri);
  const check = (bytes: number) => {
    const message = serverPrecheck({ bytes, seconds: input.seconds });
    if (message) throw new AIError("AUDIO_TOO_LONG", message);
  };
  check(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkCanceled();
  check(bytes.byteLength);
  const result = await upload<{ text: unknown }>("/ai/transcribe", bytes, "audio/mp4", {
    "X-Request-Id": Crypto.randomUUID(),
    ...(input.seconds ? { "X-Audio-Seconds": String(Math.ceil(input.seconds)) } : {}),
  }, signal);
  if (typeof result?.text !== "string")
    throw new AIError("INVALID_RESULT", "转写结果无效，录音已保存。");
  return result.text;
}
