export const MODEL_ID = 'deepseek-flash' as const;
export const MODEL_LABEL = 'DeepSeek Flash High';
export const MODEL_IDS = [MODEL_ID] as const;
// Accept the previous app's stored selections, then normalize every request.
export const LEGACY_MODEL_IDS = [MODEL_ID, 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-6-astra'] as const;
