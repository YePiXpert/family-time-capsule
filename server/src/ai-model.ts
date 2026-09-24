export const MODEL_ID = 'gpt-6-astra' as const;
export const MODEL_LABEL = 'GPT-6 Astra';
export const TRANSCRIBE_MODEL_ID = 'mimo-v2.5-asr' as const;
export const MODEL_IDS = [MODEL_ID] as const;
// Accept the previous app's stored selections, then normalize every request.
export const LEGACY_MODEL_IDS = [MODEL_ID, 'mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.5', 'deepseek-flash', 'gpt-5.6-luna', 'gpt-5.6-sol'] as const;

// Owner-selected GPT-6 Astra medium for all five text modes.
export const REASONING_POLICY = {
 question:'medium', ask:'medium', polish:'medium',
 recap:'medium', editor:'medium',
} as const;
// Shared by reasoning and final JSON; preserve the existing annual-editor budget.
export const MAX_COMPLETION_TOKENS = 16384;
