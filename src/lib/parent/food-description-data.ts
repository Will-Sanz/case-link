import "server-only";
import { z } from "zod";
import { intakeSchema, mandateSchema, reusedZipSourceSchema } from "./domain";
import { familyProfileSourceSchema } from "./family-profile";
import { snapApplicationFieldsValueSchema } from "./snap-application-fields";
import { snapFormTemplateIdSchema } from "./snap-form-source";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { foodDescriptionSourceSchema } from "./food-assessment";
import { createParentClient, requireParentSession } from "./auth";
import { getParentDeletionStatus } from "./account-deletion";
import { foodDescriptionContextSchema, foodDescriptionCurrentRequestsSchema, reconcileFoodDescriptionRequests, foodDescriptionProjectionSchema, foodDescriptionSelectionSchema, validateFoodDescriptionSelection } from "./food-description";
import { FoodDescriptionError, foodDescriptionArchiveSchema, foodDescriptionMutationSchema } from "./food-description-draft";
function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "P0001" && ["parent_family_profile_source_changed", "parent_reuse_source_changed"].includes(error.message ?? "")) throw new Error(error.message);
  if (error.code === "42501") throw new FoodDescriptionError(403, "unavailable");
  if (["PT409", "40001"].includes(error.code ?? "")) throw new FoodDescriptionError(409, "changed");
  if (["23514", "22023"].includes(error.code ?? "")) throw new FoodDescriptionError(400, "invalid");
  if (error.message === "description resource limit") throw new FoodDescriptionError(429, "resource_limit");
  throw new FoodDescriptionError(503, "service");
}
export async function foodDescriptionAvailable() {
  const client = await createParentClient();
  const { data, error } = await client.rpc("parent_food_description_available"); check(error);
  return data === true;
}
/** Retained rights require the existing current owner/session, even when new collection is closed. */
export async function getFoodDescriptionArchive() {
  const client = await createParentClient(), identity = await getParentDeletionStatus(client);
  const { data, error } = await client.rpc("parent_get_food_descriptions"); check(error);
  const result = foodDescriptionArchiveSchema.safeParse(data);
  if (!result.success || result.data.ownerId !== identity.ownerId) throw new FoodDescriptionError(503, "service");
  return result.data;
}
export async function getFoodDescriptionResult(draftId: string, expected?: { ownerId?: string; revision: number }) {
  const id = z.uuid().parse(draftId), client = await createParentClient(), identity = await getParentDeletionStatus(client);
  const { data, error } = await client.rpc("parent_food_description_result", { p_draft: id }); check(error);
  const value = z.object({ projection: foodDescriptionProjectionSchema, selection: foodDescriptionSelectionSchema, currentContext: foodDescriptionContextSchema, currentRequests: foodDescriptionCurrentRequestsSchema }).strict().parse(data);
  if (value.currentContext.ownerId !== identity.ownerId || expected?.ownerId && value.currentContext.ownerId !== expected.ownerId) throw new FoodDescriptionError(403, "unavailable");
  if (expected && value.currentContext.revision !== expected.revision) throw new FoodDescriptionError(409, "changed");
  try {
    return reconcileFoodDescriptionRequests(validateFoodDescriptionSelection({ projection: value.projection, selection: value.selection, currentContext: value.currentContext, now: new Date() }), value.currentRequests, identity.ownerId);
  } catch { throw new FoodDescriptionError(409, "changed"); }
}
export async function mutateFoodDescription(input: unknown) {
  const value = foodDescriptionMutationSchema.parse(input);
  if (value.action === "queue" && value.input.description !== (input as { input: { description: string } }).input.description) throw new FoodDescriptionError(400, "invalid");
  const client = value.action === "cancel" ? await createParentClient() : (await requireParentSession()).supabase;
  const identity = await getParentDeletionStatus(client);
  if (identity.ownerId !== value.expectedOwnerId) throw new FoodDescriptionError(403, "unavailable");
  if (value.action === "create") {
    const reply = await client.rpc("parent_create_food_description", { p_expected_owner: value.expectedOwnerId, p_create_key: value.idempotencyKey, p_notice_version: value.noticeVersion, p_consented: value.consentAccepted }); check(reply.error);
    return { draftId: z.uuid().parse(reply.data), revision: 0 };
  }
  if (value.action === "queue") {
    const reply = await client.rpc("parent_queue_food_description", { p_draft_id: value.draftId, p_expected_owner: value.expectedOwnerId, p_expected_revision: value.expectedRevision, p_queue_key: value.idempotencyKey, p_input: { ...value.input, ...(value.routingAnswers ? { routingAnswers: value.routingAnswers } : {}) } }); check(reply.error);
    return { draftId: value.draftId, revision: z.number().int().positive().parse(reply.data) };
  }
  if (value.action === "resolve") {
    const reply = await client.rpc("parent_resolve_food_description", { p_draft: value.draftId, p_expected_owner: value.expectedOwnerId, p_expected_revision: value.expectedRevision,
      p_answers: value.answers, p_changed_fields: value.changedQuestionIds, p_idempotency_key: value.idempotencyKey }); check(reply.error);
    return { draftId: value.draftId, revision: z.number().int().positive().parse(reply.data) };
  }
  const reply = await client.rpc("parent_cancel_food_description", { p_draft_id: value.draftId, p_expected_owner: value.expectedOwnerId }); check(reply.error);
  return { draftId: value.draftId, cancelled: true };
}

export async function authorizeFoodDescriptionCollection(draftId: string | null) {
  const { supabase, user } = await requireParentSession();
  if (draftId !== null) {
    const id = z.uuid().parse(draftId);
    const { data, error } = await supabase.rpc("parent_food_description_upload_allowed", { p_draft: id }); check(error);
    if (data !== true) throw new FoodDescriptionError(403, "unavailable");
  }
  return user.id;
}

/** One actual start, through the existing atomic service/private SNAP ports; no description content is copied. */
export async function startFoodDescriptionRequest(input: unknown, idempotencyKey: string): Promise<string> {
  const common = { descriptionSource: foodDescriptionSourceSchema, intake: intakeSchema, mandate: mandateSchema, reusedZip: reusedZipSourceSchema.optional() };
  const value = z.union([
    z.object(common).strict(),
    z.object({ ...common, kind: z.literal("snap_application"), details: snapApplicationFieldsValueSchema, noticeVersion: z.literal(SNAP_APPLICATION_NOTICE_VERSION),
      familyProfileSource: familyProfileSourceSchema.optional(), documentTemplateId: snapFormTemplateIdSchema.optional() }).strict(),
  ]).parse(input);
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_start_food_description_request", {
    p_description_source: value.descriptionSource, p_intake: value.intake, p_mandate: value.mandate, p_idempotency_key: z.uuid().parse(idempotencyKey),
    ...(value.reusedZip ? { p_zip_source: value.reusedZip } : {}),
    ...("kind" in value ? { p_snap_details: value.details, p_snap_notice_version: value.noticeVersion,
      ...(value.familyProfileSource ? { p_family_profile_source: value.familyProfileSource } : {}), ...(value.documentTemplateId ? { p_snap_template_id: value.documentTemplateId } : {}) }
      : {}),
  });
  check(error); return z.uuid().parse(data);
}
