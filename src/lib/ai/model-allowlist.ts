/**
 * Restricts env-driven and resolved model IDs to known OpenAI API model id shapes.
 * Blocks typos and accidental expensive / non-API strings from being sent to the API.
 */
export function isAllowedOpenAiModelId(raw: string): boolean {
  const id = raw.trim();
  if (!id || id.length > 80) return false;
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) return false;

  const lower = id.toLowerCase();

  if (lower.startsWith("gpt-4") || lower.startsWith("gpt-3.5")) return true;
  if (lower.startsWith("gpt-5")) return true;
  if (/^o[0-9]/.test(lower)) return true;
  if (lower.startsWith("chatgpt-4o")) return true;

  return false;
}
