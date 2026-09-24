export const MODEL_ID = 'gpt-6-astra' as const;
export const MODEL_LABEL = 'GPT-6 Astra';
export const TRANSCRIBE_MODEL_ID = 'mimo-v2.5-asr' as const;
export const MODEL_IDS = [MODEL_ID] as const;
// Owner-selected GPT-6 Astra medium for all five text modes.
export const REASONING_POLICY = {
 question:'medium', ask:'medium', polish:'medium',
 recap:'medium', editor:'medium',
} as const;
// Shared by reasoning and final JSON; preserve the existing annual-editor budget.
export const MAX_COMPLETION_TOKENS = 16384;
