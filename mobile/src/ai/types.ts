export type OrganizerCapability = "text" | "vision" | "transcription";
export type AiSettings = {
  valid: boolean;
  configured: boolean;
  configurationId: string | null;
  provider: string | null;
  external: boolean;
  canConfigure: boolean;
  workerAvailable: boolean;
  capabilities: {
    capability: OrganizerCapability;
    model: string | null;
    available: boolean;
    consented: boolean;
    check: { state: "untested" | "passed" | "failed"; testedAt: string | null; code: string | null };
  }[];
};
