import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { factAnswerSchema, type FactAnswer } from "./answers";
import { mandateSchema, type ServiceMandate } from "./domain";
import { validateMandate } from "./policy";
import { getParentAuthorizationWindow } from "./authorization-window";

async function mutate(
  name: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc(name, parameters);
  if (error?.code === "40001")
    throw new Error(
      "This request changed. Reload it before saving your update.",
    );
  if (error)
    throw new Error(
      "This request is unavailable, or its permission has changed.",
    );
}
export async function answerParentFact(
  id: string,
  input: FactAnswer,
): Promise<void> {
  const value = factAnswerSchema.parse(input);
  await mutate("parent_answer_fact", {
    p_request_id: z.uuid().parse(id),
    p_need: value.need,
    p_field: value.field,
    p_value: value.value,
    p_expected_version: value.version,
  });
}
export async function replaceParentMandate(
  id: string,
  mandate: ServiceMandate,
  version: number,
): Promise<void> {
  const parsed = mandateSchema.parse(mandate);
  const authorization = await getParentAuthorizationWindow();
  if (validateMandate(parsed, new Date(authorization.issuedAt)))
    throw new Error(
      "Check the named programs and permission expiry before saving.",
    );
  await mutate("parent_replace_mandate", {
    p_request_id: z.uuid().parse(id),
    p_mandate: parsed,
    p_expected_version: z.number().int().positive().parse(version),
  });
}
export async function updateParentBooking(
  id: string,
  preference: ServiceMandate["bookingPreference"],
  version: number,
): Promise<void> {
  await mutate("parent_update_booking_preference", {
    p_request_id: z.uuid().parse(id),
    p_preference: mandateSchema.shape.bookingPreference.parse(preference),
    p_expected_version: z.number().int().positive().parse(version),
  });
}
