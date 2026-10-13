import type { CaseAssistantHistoryItem } from "@/types/case-assistant";

export const MAX_QUESTION_CHARS = 4000;
export const MAX_HISTORY_MESSAGES = 40;
export const MAX_HISTORY_CHARS = 12_000;
export const MAX_HISTORY_MESSAGE_CHARS = 8000;
export const MAX_VISIBLE_MESSAGES = 100;

/** Keep a contiguous tail of complete exchanges; never send an orphaned answer. */
export function recentConversation(history: CaseAssistantHistoryItem[]): CaseAssistantHistoryItem[] {
  const result: CaseAssistantHistoryItem[] = [];
  let chars = 0;
  for (let i = history.length - 1; i > 0 && result.length < MAX_HISTORY_MESSAGES; i -= 2) {
    const user = history[i - 1];
    const assistant = history[i];
    if (user.role !== "user" || assistant.role !== "assistant") break;
    const turnChars = user.content.length + assistant.content.length;
    if (chars + turnChars > MAX_HISTORY_CHARS || user.content.length > MAX_HISTORY_MESSAGE_CHARS || assistant.content.length > MAX_HISTORY_MESSAGE_CHARS) break;
    result.unshift({ role: user.role, content: user.content }, { role: assistant.role, content: assistant.content });
    chars += turnChars;
  }
  return result;
}
