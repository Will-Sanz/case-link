import {
  askParentAssistant,
  cancelParentAssistantQuestion,
  getParentAssistantConversation,
  ParentAssistantError,
} from "@/lib/parent/assistant-data";
import {
  parentError,
  parentJson,
  readParentJson,
  requireSameOrigin,
  uuidSchema,
} from "@/lib/parent/http";
import { z } from "zod";
function errorResponse(error: unknown): Response {
  return error instanceof ParentAssistantError
    ? parentJson({ ok: false, error: error.message }, error.status)
    : parentError(error);
}
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const id = uuidSchema.parse((await context.params).id);
    return parentJson({
      ok: true,
      ...(await getParentAssistantConversation(id)),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await context.params).id);
    return parentJson(
      {
        ok: true,
        id: await askParentAssistant(id, await readParentJson(request)),
      },
      202,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await context.params).id),
      input = z
        .object({ messageId: uuidSchema })
        .strict()
        .parse(await readParentJson(request));
    await cancelParentAssistantQuestion(id, input.messageId);
    return parentJson({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
