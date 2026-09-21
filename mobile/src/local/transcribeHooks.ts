import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { getToken } from "../ai/client";
import { transcribeOnServer } from "../ai/transcribe";
import { speechAvailability, transcribeFile } from "../../modules/speech-recognition/src";
import { mediaFile } from "./files";
import type { LocalMedia } from "./model";
import type { LocalStore } from "./store";
import { runTranscription, type TranscriptionConsent, type TranscriptionState } from "./transcribeRun";

function askConsent(signal: AbortSignal): Promise<TranscriptionConsent> {
  return new Promise((resolve) => {
    const finish = (choice: TranscriptionConsent) => {
      signal.removeEventListener("abort", cancel);
      resolve(choice);
    };
    const cancel = () => finish("cancel");
    signal.addEventListener("abort", cancel);
    if (signal.aborted) { cancel(); return; }
    Alert.alert("把这段录音转成文字？", "会把这一段录音经主人的服务发送给转写模型（小米 MiMo），只用来转成文字；服务器不保存声音，转写计一次写作额度。", [
      { text: "取消", style: "cancel", onPress: cancel },
      { text: "这次同意", onPress: () => finish("once") },
      { text: "以后都同意", onPress: () => finish("always") },
    ], { cancelable: true, onDismiss: cancel });
  });
}
export function useTranscription(
  store: LocalStore,
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
      consent: () => store.get().settings.transcribeConsent === true,
      askConsent,
      rememberConsent: () => store.change((s) => { s.settings.transcribeConsent = true; }),
      onDevice: (signal) => transcribeFile(mediaFile(media).uri, { signal }),
      onServer: (signal) => transcribeOnServer({ uri: mediaFile(media).uri, seconds }, signal),
      onTranscript: (text) => receive.current(text),
      onState: setState,
      platform: Platform.OS === "ios" ? "ios" : "android",
    }, job.signal);
    if (controller.current === job) controller.current = null;
  }, [store, stop]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  return { ...state, begin, stop };
}
