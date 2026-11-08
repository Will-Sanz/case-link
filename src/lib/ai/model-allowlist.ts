/** Only models with tested request contracts may be selected through configuration. */
export const OPENAI_MODELS = {
  "gpt-6-astra": { reasoning: true, maxOutputTokens: 128_000 },
  "gpt-6.1-sol": { reasoning: true, maxOutputTokens: 128_000 },
  "gpt-6-luna": { reasoning: true, maxOutputTokens: 128_000 },
  "gpt-5.6-luna": { reasoning: true, maxOutputTokens: 128_000 },
  "gpt-4o": { reasoning: false, maxOutputTokens: 16_384 },
} as const;

export function isAllowedOpenAiModelId(raw: string): raw is keyof typeof OPENAI_MODELS {
  return Object.hasOwn(OPENAI_MODELS, raw);
}
