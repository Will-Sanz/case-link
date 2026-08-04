/**
 * User-selectable AI quality/speed preset. Safe to import from client or server.
 */
export type AiMode = "fast" | "thinking";

/** Default per product preference: faster, cheaper first. */
export const DEFAULT_AI_MODE: AiMode = "fast";

/** Product uses fast routing only; incoming values are normalized. */
export function parseAiMode(value: unknown): AiMode {
  void value;
  return DEFAULT_AI_MODE;
}
