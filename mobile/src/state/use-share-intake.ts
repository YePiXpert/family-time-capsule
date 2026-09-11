import { useCallback, useRef, type MutableRefObject } from "react";
import { getActiveDestination } from "../storage/database";
import { drainNativeShareIntake } from "../native/intake";

type Options = {
  clearingLocalRef: MutableRefObject<boolean>;
  intakeDoneRef: MutableRefObject<Promise<void> | null>;
  reloadLocal: () => Promise<void>;
  setMessage: (message: string | null) => void;
};

/** Serializes native intake and lets account cleanup drain all started writes. */
export function useShareIntake({ clearingLocalRef, intakeDoneRef, reloadLocal, setMessage }: Options) {
  const intakeInFlight = useRef(false);
  const intakeAgain = useRef(false);
  return useCallback(async () => {
    if (clearingLocalRef.current) return;
    if (intakeInFlight.current) {
      intakeAgain.current = true;
      return;
    }
    intakeInFlight.current = true;
    let finish!: () => void;
    intakeDoneRef.current = new Promise<void>((resolve) => { finish = resolve; });
    try {
      do {
        intakeAgain.current = false;
        const scope = await getActiveDestination() ?? "local";
        const result = await drainNativeShareIntake(scope);
        if (result.manifests === 0 && !result.recovered && !result.recoveryPending) continue;
        await reloadLocal();
        const recoveryNotice = `${result.recovered ? `已找回 ${result.recovered} 份本机资料，尚未上传。` : ""}${result.recoveryPending ? `有 ${result.recoveryPending} 份旧资料暂时无法打开，请核对本机文件。` : ""}`;
        const failed = result.failed > 0 ? ` ${result.failed} 项复制失败，请打开收件核对。` : "";
        setMessage(`${result.manifests ? "分享内容已保存在本机。打开“收到的内容”，可加入草稿或仅存资料库。" : ""}${failed}${recoveryNotice}`);

      } while (intakeAgain.current && !clearingLocalRef.current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "系统分享仍保留在本机，稍后会再次接管。");
    } finally {
      intakeInFlight.current = false;
      intakeDoneRef.current = null;
      finish();
    }
  }, [clearingLocalRef, intakeDoneRef, reloadLocal, setMessage]);

}
