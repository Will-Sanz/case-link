import { z } from "zod";

const tokenCount = z.number().int().nonnegative().optional();
export const aiUsageSchema = z.object({
  input_tokens: tokenCount, output_tokens: tokenCount, total_tokens: tokenCount,
  input_tokens_details: z.object({ cached_tokens: tokenCount, cache_write_tokens: tokenCount, cache_creation_tokens: tokenCount }).optional(),
  output_tokens_details: z.object({ reasoning_tokens: tokenCount }).optional(),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;

/** USD per million tokens, Standard rates checked 2026-10-15: https://developers.openai.com/api/docs/pricing */
const RATES = {
  "gpt-6-astra": { input: 10, cached: 1, write: 12.5, output: 50 },
  "gpt-6.1-sol": { input: 2, cached: .1, write: 2.5, output: 10 },
  "gpt-6-luna": { input: .1, cached: .01, write: .125, output: .5 },
  "gpt-5.6-luna": { input: .2, cached: .02, write: .25, output: 1.2 },
  "gpt-4o": { input: 2.5, cached: 1.25, write: null, output: 10 },
} as const;

/** Reasoning tokens are already included in output_tokens; never bill them twice. Unknown rates stay unknown. */
export function estimateAiCost(model: string, usage: AiUsage | undefined, serviceTier = "default"): number | null {
  if (!Object.hasOwn(RATES, model) || usage?.input_tokens === undefined || usage.output_tokens === undefined) return null;
  // This product requests Standard short-context processing. Other prices need explicit verification.
  if (serviceTier !== "default" || usage.input_tokens > 272_000) return null;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const writes = usage.input_tokens_details?.cache_write_tokens ?? usage.input_tokens_details?.cache_creation_tokens ?? 0;
  if (cached + writes > usage.input_tokens) return null;
  const rates = RATES[model as keyof typeof RATES];
  if (writes > 0 && rates.write === null) return null;
  return ((usage.input_tokens - cached - writes) * rates.input + cached * rates.cached + writes * (rates.write ?? 0)
    + usage.output_tokens * rates.output) / 1_000_000;
}
