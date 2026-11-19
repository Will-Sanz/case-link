import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import {
  assistantQuestionSchema,
  type ParentAssistantConversation,
  type ParentAssistantMessage,
} from "./assistant-contract";

export class ParentAssistantError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const columns = "id,question,status,answer,error,created_at,updated_at";
function checkAssistantError(
  error: { code?: string; message?: string } | null,
): void {
  if (!error) return;
  if (error.code === "42501")
    throw new ParentAssistantError(
      403,
      "This support request is unavailable, or its permission has changed.",
    );
  if (error.message === "assistant_question_invalid")
    throw new ParentAssistantError(
      400,
      "Remove personal identifiers, account numbers, passwords and PINs before sending. Use the official program for required identity details.",
    );
  const errors: Record<string, [number, string]> = {
    assistant_unavailable: [
      503,
      "The assistant is not currently connected. Your saved support is unchanged. Please try again later.",
    ],
    assistant_pending: [
      409,
      "Your previous question is still being checked. Wait for its result before sending another.",
    ],
    assistant_daily_limit: [
      429,
      "The assistant has reached this request's daily question limit. Your saved support and official help options remain available.",
    ],
    assistant_history_limit: [
      429,
      "This request has reached its conversation limit. Export your saved history and contact CaseLink for help; no messages have been removed.",
    ],
  };
  const known = errors[error.message ?? ""];
  if (known) throw new ParentAssistantError(...known);
  throw new ParentAssistantError(
    503,
    "The assistant could not load or save this question. Your support request is unchanged. Please try again.",
  );
}
export async function getParentAssistantConversation(
  requestId: string,
): Promise<ParentAssistantConversation> {
  const id = z.uuid().parse(requestId),
    { supabase } = await requireParentSession();
  const request = await supabase
    .from("parent_requests")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  checkAssistantError(request.error);
  if (!request.data)
    throw new ParentAssistantError(404, "This support request is unavailable.");
  const [history, available] = await Promise.all([
    supabase
      .from("parent_assistant_messages")
      .select(columns)
      .eq("request_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(41),
    supabase.rpc("parent_assistant_available", { p_request_id: id }),
  ]);
  checkAssistantError(history.error);
  checkAssistantError(available.error);
  return {
    messages: (
      (history.data ?? []).slice(0, 40) as unknown as ParentAssistantMessage[]
    ).reverse(),
    historyLimited: (history.data?.length ?? 0) > 40,
    available: available.data === true,
    unavailableReason:
      available.data === true
        ? null
        : "The assistant is not currently connected. Your saved support is still available; sending questions will resume when the service is connected.",
  };
}
export async function askParentAssistant(
  requestId: string,
  input: unknown,
): Promise<string> {
  const id = z.uuid().parse(requestId),
    question = assistantQuestionSchema.parse(input),
    { supabase } = await requireParentSession();
  const result = await supabase.rpc("parent_ask_assistant", {
    p_request_id: id,
    p_question: question.question,
    p_idempotency_key: question.idempotencyKey,
    p_consented: question.consented,
  });
  checkAssistantError(result.error);
  return z.uuid().parse(result.data);
}
export async function cancelParentAssistantQuestion(
  requestId: string,
  messageId: string,
): Promise<void> {
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc("parent_cancel_assistant", {
    p_request_id: z.uuid().parse(requestId),
    p_message_id: z.uuid().parse(messageId),
  });
  checkAssistantError(error);
}
