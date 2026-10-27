import { z } from "zod";
import {
  controlSupportRequest,
  correctSupportRequest,
  getSupportRequest,
  resolveParentAction,
} from "@/lib/parent/data";
import { intakeSchema, mandateSchema } from "@/lib/parent/domain";
import { factAnswerSchema, factAnswerBundleSchema } from "@/lib/parent/answers";
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
  factAnswerSchema.safeExtend({ action: z.literal("answer_fact") }),
  factAnswerBundleSchema.safeExtend({ action: z.literal("answer_facts") }),
  z
    .object({
      action: z.literal("replace_mandate"),
      mandate: mandateSchema,
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("booking_preference"),
      preference: mandateSchema.shape.bookingPreference,
      version: z.number().int().positive(),
    })
    .strict(),
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
export async function GET(_: Request, { params }: Context) {
  try {
    const request = await getSupportRequest(
      uuidSchema.parse((await params).id),
    );
    return request
      ? parentJson({
          ok: true,
          request,
          progress: await getSupportProgress(request.id),
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
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await params).id);
    const value = actionSchema.parse(await readParentJson(request));
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
    return parentError(error);
  }
}
