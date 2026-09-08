import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { convertAudioToWav } from "@/lib/media/ffmpeg";

it("refuses a real 601-second M4A rather than returning its first ten minutes as complete", async () => {
  const directory = mkdtempSync(path.join(tmpdir(),"ftc-long-audio-"));
  try {
    const file = path.join(directory,"synthetic.m4a");
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-v","error","-f","lavfi","-i","sine=frequency=440:sample_rate=8000:duration=601","-c:a","aac","-b:a","16k",file], { timeout: 30000 });
    expect((await convertAudioToWav(file,new AbortController().signal)).status).toBe("too_long");
  } finally { rmSync(directory,{ recursive:true,force:true }); }
},30000);
