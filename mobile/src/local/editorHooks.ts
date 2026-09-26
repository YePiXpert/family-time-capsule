import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Platform } from "react-native";
import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { preserveMedia, verifyMedia } from "./files";
import { now } from "./services";
import { updateDraft, type LocalMedia, type RecordDraft } from "./model";
import type { LocalStore } from "./store";
import { messageOf } from "./ui";

/** 草稿持久化：立即写、文字防抖写、失焦/退出冲刷共用一条写路径。 */
/** 系统权限被拒：界面据此给「去系统设置开启」，而不是「重试」。 */
export class PermissionDenied extends Error {}
export function useDraftPersist(
  store: LocalStore,
  onError: (message: string) => void,
  /** 草稿引用更新时同步界面状态（setDraft）。 */
  onLocal: (next: RecordDraft) => void,
  initial?: RecordDraft,
) {
  const current = useRef<RecordDraft | undefined>(initial),
    pendingMedia = useRef<Record<string, LocalMedia>>({}),
    verified = useRef<Set<string>>(new Set()),
    writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true);
  const [importedMedia, setImportedMedia] = useState<
    Record<string, LocalMedia>
  >({});
  const writeNow = useCallback(() => {
    if (!current.current) return Promise.resolve();
    const originals = Object.values(pendingMedia.current);
    const job = store.change((s) => {
      for (const m of originals) s.media[m.id] = m;
      const stored = updateDraft(s, current.current!);
      // 库里的原记录／基准版本变了（同步救下了草稿）：手里这份跟上，标题与放弃提示照新的说。
      const d = current.current;
      if (
        d &&
        (d.recordId !== stored.recordId || d.baseRevision !== stored.baseRevision)
      ) {
        current.current = {
          ...d,
          recordId: stored.recordId,
          baseRevision: stored.baseRevision,
        };
        onLocal(current.current);
      }
    });
    void job.catch((e) => {
      if (mounted.current) onError(messageOf(e));
    });
    return job;
  }, [store, onError, onLocal]);
  const persist = useCallback(
    (next: RecordDraft, media: LocalMedia[] = []) => {
      current.current = next;
      onLocal(next);
      for (const m of media) pendingMedia.current[m.id] = m;
      if (media.length) setImportedMedia({ ...pendingMedia.current });
      return writeNow();
    },
    [writeNow, onLocal],
  );
  /** 文字类改动：草稿引用即时生效，落盘延后合并，避免每个击键全库写一次。 */
  const persistDebounced = useCallback(
    (next: RecordDraft) => {
      current.current = next;
      onLocal(next);
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(() => {
        writeTimer.current = null;
        void writeNow();
      }, 400);
    },
    [writeNow, onLocal],
  );
  const flush = useCallback(async () => {
    if (writeTimer.current) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    if (current.current)
      await persist({ ...current.current, updatedAt: now() });
  }, [persist]);
  /** 空草稿静默退场：撤掉挂起的落盘，把草稿从库里删掉；删成功后这份引用不再写回。 */
  const drop = useCallback(async () => {
    if (writeTimer.current) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    const d = current.current;
    if (!d) return;
    await store.change((s) => {
      delete s.drafts[d.id];
    });
    current.current = undefined;
  }, [store]);
  useEffect(
    () => () => {
      mounted.current = false;
      // 卸载时把还挂在防抖上的文字改动落盘。
      if (writeTimer.current) {
        clearTimeout(writeTimer.current);
        writeTimer.current = null;
        void writeNow();
      }
    },
    [writeNow],
  );
  return {
    current,
    pendingMedia,
    verified,
    importedMedia,
    persist,
    persistDebounced,
    flush,
    drop,
  };
}

/** 录音：开始、完成入库（复制后收回原件）、明确放弃。 */
export function useRecorder<D extends { recordingFile?: string }>({
  draftRef,
  verified,
  persist,
  attachRecording,
  onFinished,
}: {
  draftRef: RefObject<D | undefined>;
  verified: RefObject<Set<string>>;
  persist: (next: D, media?: LocalMedia[]) => Promise<unknown>;
  /** 录音入库后把素材 id 挂到草稿上：记录草稿挂在 content.mediaIds，信挂在 mediaIds。 */
  attachRecording: (draft: D, mediaId: string) => D;
  onFinished?: (media: LocalMedia, info: { seconds?: number }) => void;
}) {
  const recorder = useRef<AudioRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const finishJob = useRef<Promise<void> | null>(null);
  const finishAudioImpl = async (opts?: { transcribe?: boolean }) => {
    const seconds = recorder.current?.currentTime;
    if (recorder.current) {
      await recorder.current.stop();
      recorder.current.release();
      recorder.current = null;
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false });
    }
    const d = draftRef.current;
    if (!d?.recordingFile) return;
    const f = new File(Paths.document, d.recordingFile);
    if (!f.exists || !f.size)
      throw new Error("录音未形成可读取的文件，可以明确放弃后继续编辑。");
    const media = await preserveMedia(f.uri, "录音.m4a", "audio");
    await verifyMedia(media);
    verified.current.add(media.id);
    const next = attachRecording({ ...draftRef.current! }, media.id);
    delete next.recordingFile;
    await persist(next, [media]);
    // preserveMedia 是复制而非移动；入库成功后收回 document 下的原始录音。
    if (f.exists) f.delete();
    if (opts?.transcribe) onFinished?.(media, { seconds });
  };
  const finishAudio = (opts?: { transcribe?: boolean }) => {
    if (finishJob.current) return finishJob.current;
    const job = finishAudioImpl(opts).finally(() => {
      finishJob.current = null;
    });
    finishJob.current = job;
    return job;
  };
  const discardAudio = async () => {
    if (recorder.current) {
      await recorder.current.stop();
      recorder.current.release();
      recorder.current = null;
      setRecording(false);
    }
    const d = draftRef.current;
    if (d) {
      const next = { ...d },
        originalName = d.recordingFile;
      delete next.recordingFile;
      await persist(next);
      if (originalName) {
        const original = new File(Paths.document, originalName);
        if (original.exists) original.delete();
      }
    }
    await setAudioModeAsync({ allowsRecording: false });
  };
  const start = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted)
      throw new PermissionDenied("请在系统设置中允许使用麦克风。");
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    });
    // eslint-disable-next-line import/namespace
    const audio = new AudioModule.AudioRecorder({
      ...RecordingPresets.HIGH_QUALITY,
      ...(Platform.OS === "ios"
        ? RecordingPresets.HIGH_QUALITY.ios
        : RecordingPresets.HIGH_QUALITY.android),
      directory: "document",
    });
    recorder.current = audio;
    try {
      await audio.prepareToRecordAsync();
      const uri = audio.uri,
        base = Paths.document.uri.replace(/\/$/, "") + "/";
      if (!uri?.startsWith(base)) throw new Error("录音保存位置不可用。");
      await persist({
        ...draftRef.current!,
        recordingFile: uri.slice(base.length),
      });
      audio.record();
      setRecording(true);
    } catch (e) {
      audio.release();
      recorder.current = null;
      await setAudioModeAsync({ allowsRecording: false });
      throw e;
    }
  };
  useEffect(
    () => () => {
      recorder.current?.release();
    },
    [],
  );
  return { recording, start, finishAudio, discardAudio };
}
