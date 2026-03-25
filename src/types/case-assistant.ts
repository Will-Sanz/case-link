/** Prior turns sent with each case assistant request (session-scoped, not persisted). */
export type CaseAssistantHistoryItem = {
  role: "user" | "assistant";
  content: string;
};
