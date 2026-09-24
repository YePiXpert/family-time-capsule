export type WritingMode = "polish" | "recap" | "ask" | "question" | "editor";
export type AIResult = { title?: string; text?: string; questions?: string[]; first?: boolean; question?: string };
export type AIJob = {
  fingerprint: string;
  kind: "write";
  eventIndex: number;
  model: string;
  writingMode: WritingMode;
  steps: { key: string; requestId: string; result?: AIResult }[];
};
export type AIProposal = AIResult & {
  fingerprint: string;
  kind: "write";
  eventIndex: number;
  model: string;
  writingMode: WritingMode;
};
