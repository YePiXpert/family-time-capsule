import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { getToken } from "../ai/client";
import { transcribeOnServer } from "../ai/transcribe";
import { speechAvailability, transcribeFile } from "../../modules/speech-recognition/src";
import { mediaFile } from "./files";
import type { LocalMedia } from "./model";
import { runTranscription, type TranscriptionState } from "./transcribeRun";

export function useTranscription(
  onTranscript: (text: string) => void | Promise<void>,
) {
  const [state, setState] = useState<TranscriptionState>({ status: "idle", message: "" });
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const receive = useRef(onTranscript);
  useEffect(() => { receive.current = onTranscript; }, [onTranscript]);
  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    if (mounted.current) setState({ status: "idle", message: "" });
  }, []);
  const begin = useCallback(async (media: LocalMedia, seconds?: number) => {
    stop();
    if (!mounted.current) return;
    const job = new AbortController();
    controller.current = job;
    await runTranscription({
      availability: () => speechAvailability("zh-CN"),
      signedIn: async () => !!(await getToken()),
      onDevice: (signal) => transcribeFile(mediaFile(media).uri, { signal }),
      onServer: (signal) => transcribeOnServer({ uri: mediaFile(media).uri, seconds }, signal),
      onTranscript: (text) => receive.current(text),
      onState: setState,
      platform: Platform.OS === "ios" ? "ios" : "android",
    }, job.signal);
    if (controller.current === job) controller.current = null;
  }, [stop]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  return { ...state, begin, stop };
}
