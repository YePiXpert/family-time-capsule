import { useCallback, useRef, useState } from "react";
import type { Credentials, SyncConsent } from "../types";

/** Reactive identity and its live async view always change together. */
export function useAccountSession(initialCredentials: Credentials | null) {
  const [credentials, changeCredentials] = useState(initialCredentials);
  const [userId, changeUserId] = useState<string | null>(null);
  const [accountFamilyId, changeFamilyId] = useState<string | null>(null);
  const [needsOnboarding, changeOnboarding] = useState(false);
  const credentialsRef = useRef(initialCredentials);
  const userIdRef = useRef<string | null>(null);
  const familyIdRef = useRef<string | null>(null);
  const needsOnboardingRef = useRef(false);
  const consentRef = useRef<SyncConsent | null>(null);
  // Invalidates all work started for a previous connection, even at the same URL.
  const destGenRef = useRef(0);
  const connectingRef = useRef(false);
  const clearingLocalRef = useRef(false);
  const setCredentials = useCallback((value: Credentials | null) => {
    credentialsRef.current = value;
    changeCredentials(value);
  }, []);
  const setUserId = useCallback((value: string | null) => {
    userIdRef.current = value;
    changeUserId(value);
  }, []);
  const setAccountFamilyId = useCallback((value: string | null) => {
    familyIdRef.current = value;
    changeFamilyId(value);
  }, []);
  const setNeedsOnboarding = useCallback((value: boolean) => {
    needsOnboardingRef.current = value;
    changeOnboarding(value);
  }, []);
  return { credentials, userId, accountFamilyId, needsOnboarding,
    credentialsRef, userIdRef, familyIdRef, needsOnboardingRef, consentRef,
    destGenRef, connectingRef, clearingLocalRef,
    setCredentials, setUserId, setAccountFamilyId, setNeedsOnboarding };
}

export type AccountSession = ReturnType<typeof useAccountSession>;
