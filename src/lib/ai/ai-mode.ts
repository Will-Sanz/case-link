/**
 * Legacy request mode, retained for saved jobs. Task settings now determine model quality.
 */
export type AiMode = "fast" | "thinking";

/** Keep incoming clients compatible without exposing model settings to families. */
export const DEFAULT_AI_MODE: AiMode = "fast";

/** Incoming modes do not override the server's task configuration. */
export function parseAiMode(value: unknown): AiMode {
  void value;
  return DEFAULT_AI_MODE;
}
