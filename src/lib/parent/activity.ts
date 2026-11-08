import "server-only";
import { z } from "zod";
import { requireParentSession, createParentClient } from "./auth";
import { needSchema } from "./domain";
import { agencyStatusSchema, receiptSchema } from "./policy";
import { snapProtectedReferenceSchema } from "./snap-protected-operation";
const uuid = z.uuid();
export async function listRequestOperations(requestId: string) {
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase
    .from("parent_operations")
    .select(
      "id,request_id,request_version,need,program_id,action,packet_hash,state,evidence,created_at,executed_at,artifact_id,protected_packet:packet->protectedSnapPacket,form:parent_form_artifacts(preparation_only,snap_snapshot_id,snap_snapshot_hash)",
    )
    .eq("request_id", uuid.parse(requestId))
    .order("created_at", { ascending: false })
    .limit(101);
  if (error)
    throw new Error("The activity could not be loaded. Please try again.");
  return {
    operations: (data ?? []).slice(0, 100).map(operation => {
      const reference = snapProtectedReferenceSchema.safeParse(operation.protected_packet);
      return { ...operation, protected_packet: operation.need === "snap_new" && operation.program_id === "snap-pa" && operation.action === "submit" && operation.artifact_id === null && reference.success ? reference.data : null };
    }),
    historyLimited: (data?.length ?? 0) > 100,
  };
}
export async function getExactOperation(
  requestId: string,
  operationId: string,
) {
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase
    .from("parent_operations")
    .select(
      "id,request_id,request_version,program_id,action,packet,packet_hash,state,evidence,created_at,executed_at",
    )
    .eq("request_id", uuid.parse(requestId))
    .eq("id", uuid.parse(operationId))
    .maybeSingle();
  if (error)
    throw new Error("The packet could not be loaded. Please try again.");
  return data;
}
export async function reportParentOutcome(requestId: string, input: unknown) {
  const value = z
    .object({
      need: needSchema,
      outcome: z.enum([
        "support_received",
        "assistance_approved",
        "declined",
        "unresolved",
      ]),
      reference: z.string().trim().min(1).max(500),
    })
    .strict()
    .parse(input);
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc("parent_report_outcome", {
    p_request_id: uuid.parse(requestId),
    p_need: value.need,
    p_outcome: value.outcome,
    p_reference: value.reference,
  });
  if (error)
    throw new Error(
      "We couldn't save your report. Your recorded provider status is unchanged.",
    );
}
export async function closeParentRequest(requestId: string, input: unknown) {
  const value = z
    .object({
      reason: z.enum([
        "completed",
        "parent_choice",
        "all_permitted_routes_exhausted",
        "provider_declined",
        "out_of_area",
      ]),
      detail: z.string().trim().min(1).max(500),
      nextOwner: z.enum(["parent", "partner", "service_operator"]),
      reentry: z.string().trim().min(1).max(500),
    })
    .strict()
    .parse(input);
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc("parent_close_request", {
    p_request_id: uuid.parse(requestId),
    p_reason: value.reason,
    p_detail: value.detail,
    p_next_owner: value.nextOwner,
    p_reentry: value.reentry,
  });
  if (error)
    throw new Error(
      "This request cannot be closed without a recorded outcome and next step.",
    );
}
/** Trusted referral access has a separate live-auth + membership check inside its RPC. */
export async function trustedReferral(operationId: string, status?: unknown) {
  const supabase = await createParentClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user?.email_confirmed_at)
    throw new Error("Authentication required");
  if (status === undefined) {
    const { data, error } = await supabase.rpc("parent_read_referral_packet", {
      p_operation_id: uuid.parse(operationId),
    });
    if (error)
      throw new Error(
        "This request is unavailable, or its permission has changed.",
      );
    return data;
  }
  const value = z
    .object({
      state: z.enum([
        "partner_received",
        "partner_accepted",
        "agency_submitted",
        "assistance_approved",
        "support_received",
        "declined",
        "unresolved",
      ]),
      reference: z.string().trim().min(1).max(200),
      observedAt: z.iso.datetime({ offset: true }),
      agencyStatus: agencyStatusSchema.optional(),
      reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .parse(status);
  if (value.agencyStatus) {
    receiptSchema.parse({ state: value.state, source: "operator_confirmed", reference: value.reference,
      recordedAt: value.observedAt, agencyStatus: value.agencyStatus });
    if ((value.reason && value.state !== "declined") || value.agencyStatus.reference !== value.reference || Date.parse(value.agencyStatus.observedAt) !== Date.parse(value.observedAt)
      || (value.agencyStatus.interview && !Object.keys(value.agencyStatus.interview).length)
)
      throw new Error("The SNAP notice must describe the same observed SNAP status.");
  }
  const { data, error } = await supabase.rpc("parent_record_referral_status", {
    p_operation_id: uuid.parse(operationId),
    p_state: value.state,
    p_evidence: {
      reference: value.reference,
      observedAt: value.observedAt,
      ...(value.reason ? { reason: value.reason } : {}),
      ...(value.agencyStatus ? { agencyStatus: value.agencyStatus } : {}),
    },
  });
  if (error)
    throw new Error(
      "This request is unavailable, or its permission has changed.",
    );
  return data;
}
