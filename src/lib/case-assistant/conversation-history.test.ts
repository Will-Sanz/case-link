import { describe, expect, it } from "vitest";
import { recentConversation, MAX_HISTORY_CHARS } from "./conversation-history";
import { askCaseAssistantInputSchema } from "@/lib/validations/ai-actions";
import type { CaseAssistantHistoryItem } from "@/types/case-assistant";

const request = { familyId: "7f58e830-7ba1-4f78-9e0c-d1fde9b814b7", question: "What comes after that?" };
function messages(count: number): CaseAssistantHistoryItem[] {
  return Array.from({ length: count }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Message ${i}` }));
}

describe("bounded assistant history", () => {
  it.each([0, 40, 42, 100])("accepts a useful continuation after %i prior messages", (count) => {
    const all = messages(count);
    const recent = recentConversation(all);
    expect(recent).toEqual(all.slice(-40));
    expect(askCaseAssistantInputSchema.safeParse({ ...request, conversationHistory: recent }).success).toBe(true);
  });

  it("bounds total text without splitting exchanges", () => {
    const all = messages(40).map((m) => ({ ...m, content: m.content.repeat(100) }));
    const recent = recentConversation(all);
    expect(recent.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(recent.length % 2).toBe(0);
    expect(recent.at(-1)).toEqual(all.at(-1));
    expect(recent[0].role).toBe("user");
  });

  it("does not forward overlong messages, incomplete exchanges, or oversized direct requests", () => {
    const all = messages(2);
    all[1].content = "x".repeat(8001);
    expect(recentConversation(all)).toEqual([]);
    expect(recentConversation(messages(3))).toEqual([]);
    expect(askCaseAssistantInputSchema.safeParse({ ...request, conversationHistory: messages(4).map((m) => ({ ...m, content: "x".repeat(4000) })) }).success).toBe(false);
    expect(askCaseAssistantInputSchema.safeParse({ ...request, question: "x".repeat(4001) }).success).toBe(false);
  });
});
