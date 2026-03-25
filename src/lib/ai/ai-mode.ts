/**
 * User-selectable AI quality/speed preset. Safe to import from client or server.
 */
export type AiMode = "fast" | "thinking";

export const AI_MODE_STORAGE_KEY = "planning-companion-ai-mode";

/** Default per product preference: faster, cheaper first. */
export const DEFAULT_AI_MODE: AiMode = "fast";

export function parseAiMode(value: unknown): AiMode {
  if (value === "thinking" || value === "fast") return value;
  return DEFAULT_AI_MODE;
}
