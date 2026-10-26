import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireParentSession } from "./auth";
import {
  intakeSchema,
  mandateSchema,
  type ParentDocument,
  type ParentPreferences,
  type ServiceMandate,
  type SupportIntake,
  type SupportRequest,
} from "./domain";

const uuid = z.uuid();
import { DOCUMENT_CONSENT_VERSION } from "./constants";
export { DOCUMENT_CONSENT_VERSION } from "./constants";
export const PARENT_DOCUMENT_BUCKET = "parent-documents";
export const parentPreferencesSchema = z
  .object({
    contactPreference: z.enum(["in_app", "email"]),
    language: z.enum(["en", "es"]),
    quietHoursStart: z.number().int().min(0).max(23),
    quietHoursEnd: z.number().int().min(0).max(23),
  })
  .strict();

function check(error: unknown): void {
  if (!error) return;
  const code =
    typeof error === "object" && "code" in error ? error.code : undefined;
  if (
    code === "P0001" &&
    typeof error === "object" &&
    "message" in error &&
    error.message === "parent_document_limit"
  )
    throw new Error(
      "This request has reached its document limit. Remove an unused document or enter the information manually.",
    );
  if (code === "40001")
    throw new Error(
      "This request changed. Reload it before saving your update.",
    );
  if (code === "42501")
    throw new Error(
      "This request is unavailable, or its permission has changed.",
    );
  throw new Error(
    "CaseLink could not save or load this information. Please try again.",
  );
}

export async function getHousehold(): Promise<{
  id: string;
  owner_id: string;
  preferences: ParentPreferences;
}> {
  const { supabase, user } = await requireParentSession();
  const [household, account] = await Promise.all([
    supabase
      .from("parent_households")
      .select("id,owner_id")
      .eq("owner_id", user.id)
      .single(),
    supabase
      .from("parent_accounts")
      .select("preferences")
      .eq("id", user.id)
      .single(),
  ]);
  check(household.error);
  check(account.error);
  return {
    ...household.data!,
    preferences: parentPreferencesSchema.parse(account.data!.preferences),
  };
}
const requestColumns =
  "id,household_id,status,intake,mandate,plan,required_actions,version,created_at,updated_at,next_actor,next_trigger,next_run_at,facts,account_changed_at";
const eventColumns = "id,request_id,kind,actor,summary,created_at,evidence";
const documentColumns =
  "id,request_id,filename,media_type,size_bytes,status,expires_at,created_at";
const pageSize = 100;

async function allParentRows(
  supabase: SupabaseClient,
  table: string,
  columns: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (;;) {
    let query = supabase
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    check(error);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
    cursor = uuid.parse(page[page.length - 1].id);
  }
}
export async function listSupportRequests(): Promise<SupportRequest[]> {
  const { supabase } = await requireParentSession();
  const requests = await allParentRows(
    supabase,
    "parent_requests",
    requestColumns,
  );
  return (requests as unknown as SupportRequest[]).sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
}

/** Read the complete retained parent-purpose history in sequential, ownership-filtered pages. */
export async function exportParentInformation() {
  const { supabase } = await requireParentSession();
  const exportedAt = new Date().toISOString();
  const household = await getHousehold();
  const requests = await allParentRows(
    supabase,
    "parent_requests",
    requestColumns,
  );
  const tables = [
    ["events", "parent_events", eventColumns],
    [
      "documents",
      "parent_documents",
      `${documentColumns},page_count,consent_version,upload_confirmed_at,facts,source_observed_at,facts_valid_until`,
    ],
    [
      "operations",
      "parent_operations",
      "id,request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,document_ids,idempotency_key,permission_version,artifact_id,mandate_hash,authorization_snapshot,state,evidence,created_at,updated_at,executed_at",
    ],
    [
      "receipts",
      "parent_receipts",
      "id,request_id,operation_id,state,attribution,evidence,evidence_hash,created_at",
    ],
    [
      "mandates",
      "parent_mandates",
      "id,request_id,request_version,mandate,mandate_hash,accepted_at",
    ],
    [
      "forms",
      "parent_form_artifacts",
      "id,request_id,request_version,need,program_id,template_id,template_version,template_hash,form_input_digest,content_sha256,status,expires_at,created_at",
    ],
  ] as const;
  for (const [key, table, columns] of tables) {
    const rows = await allParentRows(supabase, table, columns);
    const byRequest = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const requestId = String(row.request_id);
      const group = byRequest.get(requestId) ?? [];
      group.push(row);
      byRequest.set(requestId, group);
    }
    for (const request of requests)
      request[key] = byRequest.get(String(request.id)) ?? [];
  }
  return { exportedAt, household, requests };
}
export async function getSupportRequest(
  id: string,
): Promise<SupportRequest | null> {
  uuid.parse(id);
  const { supabase } = await requireParentSession();
  const request = await supabase
    .from("parent_requests")
    .select(requestColumns)
    .eq("id", id)
    .maybeSingle();
  check(request.error);
  if (!request.data) return null;
  const [events, documents] = await Promise.all([
    supabase
      .from("parent_events")
      .select(eventColumns)
      .eq("request_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(201),
    supabase
      .from("parent_documents")
      .select(
        "id,request_id,filename,media_type,size_bytes,status,expires_at,created_at",
      )
      .eq("request_id", id)
      .neq("status", "deletion_pending")
      .order("created_at", { ascending: false }),
  ]);
  check(events.error);
  check(documents.error);
  return {
    ...request.data,
    events: (events.data ?? []).slice(0, 200).reverse(),
    events_truncated: (events.data?.length ?? 0) > 200,
    documents: documents.data ?? [],
  } as SupportRequest;
}
export async function startSupportRequest(
  intake: SupportIntake,
  mandate: ServiceMandate,
  idempotencyKey?: string,
): Promise<string> {
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_start_request", {
    p_intake: intakeSchema.parse(intake),
    p_mandate: mandateSchema.parse(mandate),
    p_idempotency_key: idempotencyKey ? uuid.parse(idempotencyKey) : null,
  });
  check(error);
  return uuid.parse(data);
}
export async function controlSupportRequest(
  id: string,
  action: "pause" | "resume" | "cancel",
): Promise<void> {
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc("parent_control_request", {
    p_request_id: uuid.parse(id),
    p_action: z.enum(["pause", "resume", "cancel"]).parse(action),
  });
  check(error);
}
export async function correctSupportRequest(
  id: string,
  intake: SupportIntake,
  expectedVersion: number,
): Promise<void> {
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc("parent_correct_request", {
    p_request_id: uuid.parse(id),
    p_intake: intakeSchema.parse(intake),
    p_expected_version: z.number().int().positive().parse(expectedVersion),
  });
  check(error);
}
export async function updateParentPreferences(
  preferences: ParentPreferences,
): Promise<void> {
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc("parent_update_preferences", {
    p_preferences: parentPreferencesSchema.parse(preferences),
  });
  check(error);
}
export async function requestAccountDeletion(): Promise<void> {
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc("parent_request_deletion");
  check(error);
}

const documentSchema = z
  .object({
    requestId: uuid,
    filename: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\p{Cc}/\\]+$/u),
    mediaType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    sizeBytes: z.number().int().min(1).max(10485760),
    pageCount: z.number().int().min(1).max(5).nullable(),
    consentVersion: z.literal(DOCUMENT_CONSENT_VERSION),
  })
  .strict();
export async function registerParentDocument(
  input: z.infer<typeof documentSchema>,
): Promise<ParentDocument & { object_path: string }> {
  const value = documentSchema.parse(input);
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_register_document", {
    p_request_id: value.requestId,
    p_filename: value.filename,
    p_media_type: value.mediaType,
    p_size_bytes: value.sizeBytes,
    p_page_count: value.pageCount,
    p_consent_version: value.consentVersion,
  });
  check(error);
  return data as ParentDocument & { object_path: string };
}
export async function confirmParentDocumentUpload(
  requestId: string,
  documentId: string,
): Promise<void> {
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc("parent_confirm_document_upload", {
    p_request_id: uuid.parse(requestId),
    p_document_id: uuid.parse(documentId),
  });
  check(error);
}
export async function deleteParentDocument(
  requestId: string,
  documentId: string,
): Promise<void> {
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc("parent_delete_document", {
    p_request_id: uuid.parse(requestId),
    p_document_id: uuid.parse(documentId),
  });
  check(error);
  // The isolated retention worker erases bytes after this RPC invalidates their queued uses.
}

export async function resolveParentAction(
  requestId: string,
  actionId: string,
  value: string,
): Promise<void> {
  const { supabase } = await requireParentSession();
  const { error } = await supabase.rpc("parent_resolve_action", {
    p_request_id: uuid.parse(requestId),
    p_action_id: z.string().min(1).max(120).parse(actionId),
    p_value: z.string().trim().min(1).max(2000).parse(value),
  });
  check(error);
}
