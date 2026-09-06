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
    /** M6 双路由:该能力实际接收服务名(单通道时与 provider 一致)。 */
    receiver?: string | null;
    /** M6 双路由:按能力的部署身份,同意提交时使用。 */
    configurationId?: string;
    check: { state: "untested" | "passed" | "failed"; testedAt: string | null; code: string | null };
  }[];
};
