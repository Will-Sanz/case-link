import "server-only";
import { z } from "zod";
import { createParentClient, requireParentSession } from "./auth";
import { getParentDeletionStatus } from "./account-deletion";
import { foodDescriptionContextSchema, foodDescriptionProjectionSchema, foodDescriptionSelectionSchema, validateFoodDescriptionSelection } from "./food-description";
import { FoodDescriptionError, foodDescriptionArchiveSchema, foodDescriptionMutationSchema } from "./food-description-draft";
function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
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
export async function getFoodDescriptionResult(draftId: string) {
  const id = z.uuid().parse(draftId), client = await createParentClient(), identity = await getParentDeletionStatus(client);
  const { data, error } = await client.rpc("parent_food_description_result", { p_draft: id }); check(error);
  const value = z.object({ projection: foodDescriptionProjectionSchema, selection: foodDescriptionSelectionSchema, currentContext: foodDescriptionContextSchema }).strict().parse(data);
  if (value.currentContext.ownerId !== identity.ownerId) throw new FoodDescriptionError(403, "unavailable");
  try {
    return validateFoodDescriptionSelection({ projection: value.projection, selection: value.selection, currentContext: value.currentContext, now: new Date() });
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
    const reply = await client.rpc("parent_queue_food_description", { p_draft_id: value.draftId, p_expected_owner: value.expectedOwnerId, p_expected_revision: value.expectedRevision, p_queue_key: value.idempotencyKey, p_input: value.input }); check(reply.error);
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
