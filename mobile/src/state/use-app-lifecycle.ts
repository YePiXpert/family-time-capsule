import { useEffect, type MutableRefObject } from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import { subscribeToPendingNativeShares } from "../../modules/share-intake/src";
import type { Credentials } from "../types";

type Options = {
  credentials: Credentials | null;
  destGenRef: MutableRefObject<number>;
  needsOnboardingRef: MutableRefObject<boolean>;
  connectingRef: MutableRefObject<boolean>;
  reloadLocal: () => Promise<void>;
  runSync: () => Promise<void>;
  receiveSystemShares: () => Promise<void>;
  setMessage: (message: string | null) => void;
};

/** All fire-and-forget native events terminate here, including their failures. */
export function useAppLifecycle({ credentials, destGenRef, needsOnboardingRef, connectingRef,
  reloadLocal, runSync, receiveSystemShares, setMessage }: Options) {
  useEffect(() => {
    let active = true;
    const generation = destGenRef.current;
    const launch = (operation: () => Promise<void>) => {
      const eventGeneration = destGenRef.current;
      void operation().catch(error => {
        if (active && eventGeneration === destGenRef.current) {
          setMessage(error instanceof Error ? error.message : "暂时无法刷新，本机资料仍保留。");
        }
      });
    };
    const sync = async () => {
      if (active && credentials && !needsOnboardingRef.current && !connectingRef.current) await runSync();
    };
    const refresh = async () => { await receiveSystemShares(); await sync(); };
    const timer = setTimeout(() => launch(async () => {
      await reloadLocal();
      if (generation === destGenRef.current) await sync();
    }), 0);
    const intakeTimer = setTimeout(() => launch(receiveSystemShares), 0);
    const unsubscribe = subscribeToPendingNativeShares(() => launch(receiveSystemShares));
    const appState = AppState.addEventListener("change", state => {
      if (state === "active") launch(refresh);
    });
    const network = Network.addNetworkStateListener(state => {
      if (state.isConnected) launch(sync);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(intakeTimer);
      unsubscribe();
      appState.remove();
      network.remove();
    };
  }, [connectingRef, credentials, destGenRef, needsOnboardingRef, receiveSystemShares, reloadLocal, runSync, setMessage]);
}
