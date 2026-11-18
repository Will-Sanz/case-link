import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { supportUpdateReceiptSchema, supportUpdateSchema, type SupportUpdate } from "./support-update";

export class SupportUpdateRejectedError extends Error { constructor() { super("parent_invalid_input"); } }

function mutationError(code: string | undefined): never {
  if (code === "40001" || code === "PT409") throw new Error("This request changed. Reload it before saving your update.");
  if (code === "23514" || code === "22P02") throw new SupportUpdateRejectedError();
  throw new Error("This request is unavailable, or its permission has changed.");
}

export async function applySupportUpdate(id: string, key: string, input: SupportUpdate) {
  const value = supportUpdateSchema.parse(input);
  const { supabase, user } = await requireParentSession();
  // Structural validation only: an exact historical receipt must be checked before
  // current expiry/mandate policy. The RPC applies those policies for NEW writes.
  const { data, error } = await supabase.rpc("parent_apply_support_update", {
    p_request_id: z.uuid().parse(id), p_idempotency_key: z.uuid().parse(key), p_update: value,
  });
  if (error) mutationError(error.code);
  const receipt = supportUpdateReceiptSchema.safeParse(data);
  if (!receipt.success) throw new Error("Support update acknowledgement is temporarily unavailable.");
  return { ownerId: user.id, receipt: receipt.data };
}

export async function getSupportUpdateContext(id: string, key: string) {
  const { supabase, user } = await requireParentSession();
  const { data, error } = await supabase.from("parent_support_update_receipts")
    .select("id,idempotency_key,request_id,action,base_version,result_version,created_at")
    .eq("request_id", z.uuid().parse(id)).eq("idempotency_key", z.uuid().parse(key)).maybeSingle();
  if (error) throw new Error("Support update history is temporarily unavailable.");
  if (data) {
    const receipt = supportUpdateReceiptSchema.safeParse({
    id: data.id, key: data.idempotency_key, requestId: data.request_id, action: data.action,
    baseVersion: data.base_version, resultVersion: data.result_version, recordedAt: data.created_at,
    });
    if (!receipt.success) throw new Error("Support update history is temporarily unavailable.");
    return { ownerId: user.id, receipt: receipt.data, expiresAt: null, issuedAt: null };
  }
  // Quote a deadline only for a not-yet-recorded attempt. Clients retain their
  // original quote; checking an unknown save never renews it.
  const timing = await supabase.rpc("parent_authorization_window");
  const window = z.object({ issuedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }) }).strict().safeParse(timing.data);
  return { ownerId: user.id, receipt: null,
    expiresAt: !timing.error && window.success ? new Date(window.data.expiresAt).toISOString() : null,
    issuedAt: !timing.error && window.success ? new Date(window.data.issuedAt).toISOString() : null };
}
