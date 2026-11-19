import { z } from "zod";
import {
  controlSupportRequest,
  correctSupportRequest,
  getSupportRequest,
  resolveParentAction,
} from "@/lib/parent/data";
import { intakeSchema } from "@/lib/parent/domain";
import { supportUpdateSchema } from "@/lib/parent/support-update";
import { applySupportUpdate, getSupportUpdateContext, SupportUpdateRejectedError } from "@/lib/parent/support-update-data";
import { getSupportProgress } from "@/lib/parent/progress-data";
import {
  answerParentFact,
  answerParentFacts,
  replaceParentMandate,
  updateParentBooking,
} from "@/lib/parent/mutations";
import {
  parentError,
  parentJson,
  readParentJson,
  requireSameOrigin,
  uuidSchema,
} from "@/lib/parent/http";
const actionSchema = z.discriminatedUnion("action", [
  ...supportUpdateSchema.options,
  z.object({ action: z.enum(["pause", "resume", "cancel"]) }).strict(),
  z
    .object({
      action: z.literal("correct"),
      intake: intakeSchema,
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("resolve_action"),
      actionId: z.string().min(1).max(120),
      value: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
type Context = { params: Promise<{ id: string }> };
export async function GET(incoming: Request, { params }: Context) {
  try {
    const id = uuidSchema.parse((await params).id);
    const query = new URL(incoming.url).searchParams;
    const keys = query.getAll("updateKey");
    if (keys.length > 1) throw new Error("parent_invalid_input");
    const key = keys.length ? uuidSchema.parse(keys[0]) : null;
    const request = await getSupportRequest(id);
    return request
      ? parentJson({
          ok: true,
          request,
          ...(key ? { update: await getSupportUpdateContext(id, key) }
            : { progress: await getSupportProgress(request.id) }),
        })
      : parentJson(
          { ok: false, error: "This support request is unavailable." },
          404,
        );
  } catch (error) {
    return parentError(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  const keyed = request.headers.has("Idempotency-Key");
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await params).id);
    const value = actionSchema.parse(await readParentJson(request));
    const rawKey = request.headers.get("idempotency-key");
    const key = rawKey === null ? null : uuidSchema.parse(rawKey);
    if (key) return parentJson({ ok: true, update: await applySupportUpdate(id, key, supportUpdateSchema.parse(value)) });
    if (value.action === "correct")
      await correctSupportRequest(id, value.intake, value.version);
    else if (value.action === "answer_fact") {
      const { action: _, ...answer } = value;
      void _;
      await answerParentFact(id, answer);
    } else if (value.action === "answer_facts") {
      const { action: _, ...answers } = value;
      void _;
      await answerParentFacts(id, answers);
    } else if (value.action === "replace_mandate")
      await replaceParentMandate(id, value.mandate, value.version);
    else if (value.action === "booking_preference")
      await updateParentBooking(id, value.preference, value.version);
    else if (value.action === "resolve_action")
      await resolveParentAction(id, value.actionId, value.value);
    else await controlSupportRequest(id, value.action);
    const [supportRequest, progress] = await Promise.all([
      getSupportRequest(id),
      getSupportProgress(id),
    ]);
    return parentJson({ ok: true, request: supportRequest, progress });
  } catch (error) {
    const response = parentError(error);
    if (keyed && response.status === 400 && (error instanceof z.ZodError || error instanceof SupportUpdateRejectedError || error instanceof Error && error.message === "parent_invalid_input"))
      return parentJson({ ...await response.json(), supportUpdateRejected: true }, 400);
    return response;
  }
}
