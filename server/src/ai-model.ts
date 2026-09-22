export const MODEL_ID = 'mimo-v2.6-pro' as const;
export const MODEL_LABEL = 'MiMo 2.6 Pro';
export const TRANSCRIBE_MODEL_ID = 'mimo-v2.5-asr' as const;
export const MODEL_IDS = [MODEL_ID] as const;
// Accept the previous app's stored selections, then normalize every request.
export const LEGACY_MODEL_IDS = [MODEL_ID, 'mimo-v2.6-flash', 'mimo-v2.5', 'deepseek-flash', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-6-astra'] as const;

// Owner-selected initial policy, not a claim of measured optimal quality/latency.
export const THINKING_POLICY = {
 question:'disabled', ask:'disabled', polish:'disabled',
 recap:'enabled', editor:'enabled',
} as const;
// Shared by reasoning and final JSON; preserve the existing annual-editor budget.
export const MAX_COMPLETION_TOKENS = 16384;
