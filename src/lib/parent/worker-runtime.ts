import { createHash } from "node:crypto";
import { z } from "zod";
import { coordinateSupport, type CoordinatorResult } from "./coordinator";
import {
  DocumentProcessingError,
  financialSourcePages,
  processParentDocument,
} from "./document-processing";
import {
  extractedFactsSchema,
  MAX_DOCUMENT_BYTES,
  type ExtractedFacts,
} from "./documents";
import {
  storedIntakeSchema,
  mandateSchema,
  needSchema,
  type SupportAction,
  type SupportNeed,
  type SupportRequest,
} from "./domain";
import { executeSupportOperation, type ExecutablePacket } from "./execution";
import { buildSupportPlan } from "./planning";
import { fillVerifiedForm, type VerifiedFormContract } from "./forms";
import { receiptSchema } from "./policy";
import { sameSnapProtectedPacket, sameSnapProtectedOperationBinding, snapProtectedOperationSchema, snapProtectedReferenceSchema, type SnapProtectedOperation } from "./snap-protected-operation";
import { snapProtectedSubmissionResultSchema, type SnapProtectedSubmissionIntent, type SnapProtectedSubmissionPort } from "./snap-protected-submission-port";
import { parseSnapPendingCapture, runSnapCaptureCheck, snapCaptureCheckResultSchema, type SnapCapturePreparationPort, type SnapPendingCapture } from "./snap-pending-capture";
import { canonicalProjectOrigin } from "./project-origin";
import { parentStorageDownloadAllowed } from "./storage-download";
import { getProgram, programRoutingIssue } from "./programs";
import { renderSnapPreparationDraft, renderSnapApplicationPreview, SNAP_DRAFT_CONTRACT } from "./snap-draft";
import { assessSnapApplicationSnapshot, snapApplicationSnapshotSchema, SNAP_PREVIEW_TEMPLATE_ID, SNAP_PREVIEW_TEMPLATE_VERSION } from "./snap-application-snapshot";
import {
  runSupportService,
  type ServiceCapability,
  type ServiceDocument,
  type ServiceForm,
  type ServiceOperation,
  type ServicePorts,
  type ServiceProposedOperation,
} from "./service";

export type WorkerDatabase = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};
export type RuntimeArtifact = {
  id: string;
  object_path: string;
  content_sha256: string;
};
export type RuntimeTransport = {
  execute(
    input: ExecutablePacket & {
      idempotencyKey: string;
      signal: AbortSignal;
      programId: string;
      need: string;
      action: SupportAction;
      artifact?: { metadata: RuntimeArtifact; bytes: Uint8Array };
      documents?: { id: string; mediaType: string; bytes: Uint8Array }[];
    },
  ): Promise<unknown>;
  reconcile?(
    operation: Pick<
      ServiceOperation,
      "id" | "need" | "programId" | "idempotencyKey"
    >,
    signal: AbortSignal,
  ): Promise<unknown | null>;
};
/** Registered only after a real partner protocol and permission have been verified. */
export const PARENT_TRANSPORTS: ReadonlyMap<string, RuntimeTransport> =
  new Map();
export type WorkerRuntimeOptions = {
  database: WorkerDatabase;
  apiKey?: string;
  continuationOnly?: boolean;
  brokerOrigin: string;
  brokerSecret: string;
  supabaseOrigin: string;
  transports?: ReadonlyMap<string, RuntimeTransport>;
  protectedSnapSubmission?: SnapProtectedSubmissionPort;
  snapCapturePreparation?: SnapCapturePreparationPort;
  fetcher?: typeof fetch;
  now?: () => Date;
  processDocument?: typeof processParentDocument;
  coordinate?: (
    input: Parameters<typeof coordinateSupport>[0],
  ) => Promise<CoordinatorResult>;
};
const iso = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const rawOperationSchema = z
  .object({
    id: z.uuid(),
    request_version: z.number().int().positive(),
    need: needSchema,
    program_id: z.string(),
    action: z.enum([
      "research",
      "prepare",
      "share",
      "submit",
      "schedule",
      "follow_up",
    ]),
    state: z.string(),
    idempotency_key: z.string(),
    packet: z.record(z.string(), z.unknown()),
    updated_at: iso,
    created_at: iso.optional(),
    evidence: z.record(z.string(), z.unknown()).nullable().optional(),
    personalActsComplete: z.boolean().optional(),
    snapSubmissionAuthorized: z.boolean().optional(),
    protectedPacketCurrent: z.boolean().optional(),
    protectedParentSubmitReady: z.boolean().optional(),
    executed_at: z.string().nullable().optional(),
    artifact_id: z.uuid().nullable().optional(),
  })
  .passthrough();
const artifactSchema = z
  .object({
    id: z.uuid(),
    object_path: z.string().min(1).max(300),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough();
const capabilitySchema = z
  .object({
    programId: z.string(),
    enabled: z.boolean(),
    actions: z.array(
      z.enum([
        "research",
        "prepare",
        "share",
        "submit",
        "schedule",
        "follow_up",
      ]),
    ),
    permissionReference: z.string().nullable(),
    permissionVersion: z.string().nullable().optional(),
    permissionExpiresAt: z.string().nullable(),
    dataCategories: z.array(
      z.enum(["household", "income", "utility", "documents"]),
    ),
    personalActsComplete: z.boolean(),
    requiresForm: z.boolean().nullable().optional(),
    allowedFields: z.array(z.string()).optional(),
    requiredActs: z.array(z.string()).nullable().optional(),
  })
  .passthrough();
const claimSchema = z.object({
  jobId: z.uuid(),
  leaseToken: z.uuid(),
  request: z
    .object({
      id: z.uuid(),
      version: z.number().int().positive(),
      status: z.enum(["active", "paused", "cancelled", "closed"]),
      required_actions: z.array(z.unknown()),
      intake: storedIntakeSchema,
      mandate: mandateSchema,
    })
    .passthrough(),
  documents: z.array(z.record(z.string(), z.unknown())).max(10),
});
const templateSchema = z
  .object({
    id: z.string(),
    version: z.string(),
    program_id: z.string(),
    needs: z.array(needSchema),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    object_path: z.string().min(1).max(300),
    field_map: z.record(z.string(), z.string()),
    required_acts: z.array(z.string()),
    required_fields: z.array(z.string()).default([]),
    personal_fields: z.array(z.string()).default([]),
    verified_until: iso,
    active: z.literal(true),
    preparation_only: z.boolean().default(false),
  })
  .passthrough();
const digest = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const packetIdentity = (packet: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(packet).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );

export function normalizeWorkerOperation(
  value: unknown,
): ServiceOperation | null {
  const operation = rawOperationSchema.parse(value);
  const evidence = operation.evidence ?? {};
  const receipt = receiptSchema.safeParse({
    state: operation.state,
    source: evidence.source,
    reference: evidence.reference,
    recordedAt: evidence.recordedAt ?? evidence.observedAt,
    ...(evidence.agencyStatus !== undefined ? { agencyStatus: evidence.agencyStatus } : {}),
  });
  const state = receipt.success
    ? receipt.data.state
    : operation.state === "delivery_unknown"
      ? "delivery_unknown"
      : operation.state === "prepared"
        ? "prepared"
        : null;
  if (!state) return null;
  const protectedSnap = Object.hasOwn(operation.packet, "protectedSnapPacket") ? snapProtectedOperationSchema.parse({
    operationId: operation.id, requestId: operation.request_id, requestVersion: operation.request_version,
    need: operation.need, programId: operation.program_id, action: operation.action, state,
    packet: operation.packet, packetHash: operation.packet_hash, dataCategories: operation.data_categories, documentIds: operation.document_ids,
    artifactId: operation.artifact_id, idempotencyKey: operation.idempotency_key, permissionVersion: operation.permission_version,
    protectedPacketCurrent: operation.protectedPacketCurrent === true, personalActsComplete: operation.personalActsComplete === true,
    protectedParentSubmitReady: operation.protectedParentSubmitReady === true,
    snapSubmissionAuthorized: operation.snapSubmissionAuthorized === true,
  }) : undefined;
  return {
    id: operation.id,
    need: operation.need,
    programId: operation.program_id,
    action: operation.action,
    state,
    idempotencyKey: operation.idempotency_key,
    packet: operation.packet,
    updatedAt: operation.updated_at,
    ...(operation.created_at ? { createdAt: operation.created_at } : {}),
    ...(operation.executed_at ? { executedAt: operation.executed_at } : {}),
    ...(receipt.success ? { receipt: receipt.data } : {}),
    snapSubmissionAuthorized: operation.snapSubmissionAuthorized === true,
    ...(protectedSnap ? { protectedSnap } : {}),
  };
}

function normalizeDocument(raw: Record<string, unknown>): ServiceDocument {
  const records = z
    .array(
      z
        .object({
          field: z.enum([
            "provider",
            "amountDue",
            "totalBalance",
            "dueDate",
            "shutoffDate",
          ]),
          value: z.unknown(),
          page: z.number().int().min(1).max(5),
          sourceText: z.string().max(120),
          validatedAt: iso,
        })
        .passthrough(),
    )
    .parse(raw.facts ?? []);
  const facts = records.length
    ? extractedFactsSchema.parse({
        provider: "unknown",
        amountDue: null,
        totalBalance: null,
        dueDate: null,
        shutoffDate: null,
        ...Object.fromEntries(
          records.map((record) => [record.field, record.value]),
        ),
        fields: records.map(({ field, page, sourceText }) => ({
          field,
          page,
          sourceText,
        })),
      })
    : undefined;
  return {
    id: z.uuid().parse(raw.id),
    request_id: z.uuid().parse(raw.request_id),
    filename: z.string().max(200).parse(raw.filename),
    media_type: z
      .enum(["application/pdf", "image/jpeg", "image/png"])
      .parse(raw.media_type),
    size_bytes: z
      .number()
      .int()
      .min(1)
      .max(MAX_DOCUMENT_BYTES)
      .parse(raw.size_bytes),
    status: z
      .enum([
        "uploaded",
        "processing",
        "validated",
        "unreadable",
        "raw_deleted",
        "deletion_pending",
        "deleted",
      ])
      .parse(raw.status),
    expires_at: iso.parse(raw.expires_at),
    created_at: iso.parse(raw.created_at),
    consentVersion: z.string().parse(raw.consent_version),
    ...(facts
      ? {
          facts,
          validatedAt: records.map((record) => record.validatedAt).sort()[0],
        }
      : {}),
    ...(typeof raw.source_observed_at === "string"
      ? { sourceObservedAt: raw.source_observed_at }
      : {}),
    ...(typeof raw.facts_valid_until === "string"
      ? { factsExpiresAt: raw.facts_valid_until }
      : {}),
  };
}

async function readBytes(
  response: Response,
  maximum: number,
): Promise<Uint8Array> {
  if (
    !response.ok ||
    Number(response.headers.get("content-length") ?? 0) > maximum ||
    !response.body
  )
    throw new Error("private_object_unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > maximum) {
        await reader.cancel();
        throw new Error("private_object_limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!length) throw new Error("private_object_empty");
  return Buffer.concat(chunks, length);
}

/** One claim, no ambient browser session, no general storage credentials, no invented partner transport. */
export async function runOneParentJob(
  options: WorkerRuntimeOptions,
): Promise<{ state: "idle" | "saved" | "failed"; reason?: string }> {
  const db = options.database,
    fetcher = options.fetcher ?? fetch,
    now = options.now ?? (() => new Date());
  const brokerOrigin = canonicalProjectOrigin(options.brokerOrigin),
    supabaseOrigin = canonicalProjectOrigin(options.supabaseOrigin);
  if (!brokerOrigin || !supabaseOrigin || options.brokerSecret.length < 32)
    throw new Error("isolated_worker_configuration_required");
  const claimed = await db.query(
    options.continuationOnly ? "select parent_private.parent_claim_job($1,$2) as job" : "select parent_private.parent_claim_job($1) as job",
    options.continuationOnly ? [300, true] : [300],
  );
  if (!claimed.rows[0]?.job) return { state: "idle" };
  const job = claimSchema.parse(claimed.rows[0].job),
    request = job.request as unknown as SupportRequest;
  const transports = options.transports ?? PARENT_TRANSPORTS;
  const rpc = async (sql: string, values: unknown[] = []) =>
    (await db.query(sql, values)).rows[0]?.value;
  const lease = async () => {
    const rawExpiry = await rpc(
      "select parent_private.parent_renew_job_lease($1,$2) as value",
      [job.jobId, job.leaseToken],
    );
    const expiry =
      rawExpiry instanceof Date ? rawExpiry.toISOString() : rawExpiry;
    if (
      !iso.safeParse(expiry).success ||
      Date.parse(String(expiry)) <= now().getTime()
    )
      throw new Error("authority_changed");
    return String(expiry);
  };
  const beforeCall = async () => {
    await lease();
    if (
      (await rpc(
        "select parent_private.parent_reserve_ai_call($1,$2) as value",
        [job.jobId, job.leaseToken],
      )) !== true
    )
      throw new Error("ai_budget_exhausted");
  };
  const brokerGrant = async (
    bucket: string,
    objectPath: string,
    mode: "download" | "upload",
  ) => {
    await lease();
    const response = await fetcher(`${brokerOrigin}/objects`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${options.brokerSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        bucket,
        objectPath,
        mode,
      }),
    });
    if (!response.ok) throw new Error("private_object_permission_unavailable");
    return z
      .object({ signedUrl: z.url(), token: z.string().optional() })
      .parse(await response.json());
  };
  const download = async (bucket: string, path: string) => {
    const grant = await brokerGrant(bucket, path, "download");
    const url = new URL(grant.signedUrl);
    if (!parentStorageDownloadAllowed(grant.signedUrl, supabaseOrigin, bucket, path))
      throw new Error("private_download_destination_rejected");
    return readBytes(
      await fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      }),
      MAX_DOCUMENT_BYTES,
    );
  };
  const upload = async (artifact: RuntimeArtifact, bytes: Uint8Array) => {
    const grant = await brokerGrant(
      "parent-form-artifacts",
      artifact.object_path,
      "upload",
    );
    if (
      new URL(grant.signedUrl).origin !== brokerOrigin ||
      new URL(grant.signedUrl).pathname !== "/uploads" ||
      !grant.token
    )
      throw new Error("private_upload_destination_rejected");
    const response = await fetcher(grant.signedUrl, {
      method: "PUT",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${grant.token}`,
        "Content-Type": "application/pdf",
      },
      body: Buffer.from(bytes),
    });
    if (!response.ok) throw new Error("private_upload_unconfirmed");
    await rpc(
      "select parent_private.parent_confirm_form_artifact($1,$2,$3,$4) as value",
      [job.jobId, job.leaseToken, artifact.id, digest(bytes)],
    );
  };
  const loadOperations = async () => z.array(rawOperationSchema).parse(await rpc("select parent_private.parent_get_operations($1,$2) as value", [job.jobId, job.leaseToken]));
  const readPendingCapture = async (leaseUntil: string) => {
    const value = await rpc("select parent_private.parent_get_snap_pending_capture($1,$2) as value", [job.jobId, job.leaseToken]);
    return value == null ? null : parseSnapPendingCapture(value, { requestId: request.id, requestVersion: request.version, leaseUntil, now: now() });
  };
  let pendingCapture: SnapPendingCapture | null = null;
  let snapCapture: Parameters<typeof runSupportService>[0]["snapCapture"];
  let leaseUntil = "";
  const captureRetryAt = (deadline: string) => {
    const current = now().getTime(), retry = Math.min(current+300000, Date.parse(deadline)-1000, Date.parse(request.mandate.expiresAt)-1000);
    return retry>=current+30000 ? new Date(retry).toISOString() : undefined;
  };
  if (request.intake.needs.includes("snap_new")) try {
    leaseUntil = await lease(); pendingCapture = await readPendingCapture(leaseUntil);
  } catch { snapCapture = { state: "service_unavailable", reason: "check_unavailable", retryAt: captureRetryAt(leaseUntil) }; }
  let rawOperations = await loadOperations();
  let operations = rawOperations
    .map(normalizeWorkerOperation)
    .filter((operation): operation is ServiceOperation => operation !== null);
  const protectedContinuations = () => operations.flatMap(operation => {
    const canonical = operation.protectedSnap;
    return canonical?.requestId === request.id && request.intake.needs.includes("snap_new") &&
      (canonical.state === "delivery_unknown" || canonical.state === "prepared" && canonical.requestVersion === request.version &&
        canonical.protectedPacketCurrent && canonical.protectedParentSubmitReady && (!canonical.snapSubmissionAuthorized || canonical.personalActsComplete))
      ? [canonical] : [];
  });
  const priorContinuation = protectedContinuations().length > 0;
  if (pendingCapture && !priorContinuation) {
    const original = pendingCapture;
    const unresolved = operations.some(operation => operation.need === "snap_new" && operation.state === "delivery_unknown");
    const shouldCheck = !unresolved && options.snapCapturePreparation && original.intent && original.deadline &&
      (original.state === "pending" || (original.state === "service_unavailable" && original.reason === "check_unavailable"));
    let checkedOperationId: string | undefined;
    if (shouldCheck) {
      try {
        const checkStartedAt = now().getTime();
        const timeoutMs = Math.floor(Math.min(90000, Date.parse(original.deadline!) - checkStartedAt, Date.parse(leaseUntil) - checkStartedAt));
        if (timeoutMs<1) throw new Error("snap_capture_check_unconfirmed");
        const result = snapCaptureCheckResultSchema.parse(await runSnapCaptureCheck(options.snapCapturePreparation!, {
          jobId: job.jobId, leaseToken: job.leaseToken, requestId: request.id, requestVersion: request.version,
          packetId: original.packetId, intent: original.intent!, deadline: new Date(checkStartedAt+timeoutMs).toISOString(),
        }, timeoutMs));
        if (result.packetId !== original.packetId || result.requestId !== request.id || result.requestVersion !== request.version ||
          result.contentSha256 !== original.intent!.contentSha256) throw new Error("snap_capture_scope_changed");
        checkedOperationId = result.operationId;
      } catch { /* Recover a possibly committed check through fresh owned metadata, never a repeated write. */ }
      try {
        leaseUntil = await lease(); pendingCapture = await readPendingCapture(leaseUntil);
        if (!pendingCapture || pendingCapture.packetId !== original.packetId || JSON.stringify(pendingCapture.intent) !== JSON.stringify(original.intent))
          throw new Error("snap_capture_scope_changed");
        rawOperations = await loadOperations(); operations = rawOperations.map(normalizeWorkerOperation).filter((operation): operation is ServiceOperation => operation !== null);
      } catch { pendingCapture = null; }
    }
    if (!unresolved) {
      if (pendingCapture?.state === "checked") {
        const matches = operations.flatMap(operation => operation.protectedSnap?.state === "prepared" && operation.protectedSnap.protectedPacketCurrent &&
          operation.protectedSnap.requestId === request.id && operation.protectedSnap.requestVersion === request.version &&
          operation.protectedSnap.packet.protectedSnapPacket.packetId === original.packetId ? [operation.protectedSnap] : []);
        const ref = matches[0]?.packet.protectedSnapPacket, intent = original.intent;
        if (matches.length !== 1 || !intent || ref.authorizationId !== intent.authorizationId || ref.snapshotId !== intent.snapshotId ||
          ref.snapshotHash !== intent.snapshotHash || ref.contentSha256 !== intent.contentSha256 || ref.byteLength !== intent.byteLength ||
          (checkedOperationId && matches[0].operationId !== checkedOperationId)) snapCapture = { state: "service_unavailable", reason: "check_unavailable" };
      } else snapCapture = pendingCapture ? { state: pendingCapture.state, reason: pendingCapture.reason } : { state: "service_unavailable", reason: "check_unavailable" };
      if (shouldCheck && (snapCapture?.state === "pending" || (snapCapture?.state === "service_unavailable" && snapCapture.reason === "check_unavailable"))) {
        snapCapture.retryAt = captureRetryAt(original.deadline!);
      }
    }
  }
  const continuations = (priorContinuation || !snapCapture) ? protectedContinuations() : [];
  const continuation = continuations.length > 0;
  let deliveryJobAttempts: number | undefined;
  if (continuation && options.protectedSnapSubmission) try {
    deliveryJobAttempts = z.number().int().min(1).max(48).parse(await rpc(
      "select parent_private.parent_get_snap_delivery_job_attempts($1,$2) as value", [job.jobId, job.leaseToken]));
  } catch { /* Missing current scheduling authority must not promise an automatic retry. */ }
  let continuationPass = continuation;
  const serviceRequest: SupportRequest = continuation ? { ...request,
    intake: { ...request.intake, needs: ["snap_new"] }, required_actions: request.required_actions.filter(action => action.need === "snap_new"),
    plan: request.plan ? { ...request.plan, routes: request.plan.routes.filter(route => route.need === "snap_new") } : null,
  } : request;
  const protectedIntent = (canonical: SnapProtectedOperation, signal: AbortSignal): SnapProtectedSubmissionIntent => ({
    jobId: job.jobId, leaseToken: job.leaseToken, operationId: canonical.operationId, requestId: canonical.requestId,
    requestVersion: canonical.requestVersion, idempotencyKey: canonical.idempotencyKey, packetHash: canonical.packetHash,
    protectedPacket: canonical.packet.protectedSnapPacket, signal,
  });
  const documentRows = new Map(
    job.documents.map((document) => [String(document.id), document]),
  );
  const extracted = new Map<
    string,
    Awaited<ReturnType<typeof processParentDocument>>
  >();
  const prepare = async (
    operation: ServiceProposedOperation,
  ): Promise<string> => {
    if (continuationPass && (!operation.protectedSnap || !continuations.some(known => sameSnapProtectedOperationBinding(known, operation.protectedSnap!))))
      throw new Error("fresh_planning_required");
    await lease();
    if (operation.protectedSnap) {
      const current = await currentProtectedOperation(operation.protectedSnap);
      if (!current.protectedPacketCurrent || !current.protectedParentSubmitReady || !current.personalActsComplete || !current.snapSubmissionAuthorized) throw new Error("protected_operation_authority_changed");
      return current.operationId;
    }
    if (operation.form?.snapApplication) return z.uuid().parse(await rpc(
      "select parent_private.parent_prepare_snap_application_preview($1,$2,$3,$4,$5) as value",
      [job.jobId, job.leaseToken, operation.requestVersion, operation.form.artifactId, operation.idempotencyKey]));
    return z
      .uuid()
      .parse(
        await rpc(
          "select parent_private.parent_prepare_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as value",
          [
            job.jobId,
            job.leaseToken,
            operation.requestVersion,
            operation.programId,
            operation.action,
            JSON.stringify(operation.packet),
            operation.dataCategories,
            operation.documentIds,
            operation.idempotencyKey,
            operation.need,
            operation.form?.artifactId ?? null,
          ],
        ),
      );
  };
  const currentProtectedOperation = async (expected: SnapProtectedOperation) => {
    const rows = z.array(rawOperationSchema).parse(await rpc("select parent_private.parent_get_operations($1,$2) as value", [job.jobId, job.leaseToken]));
    const matches = rows.map(normalizeWorkerOperation).flatMap(value => value?.protectedSnap && value.id === expected.operationId ? [value.protectedSnap] : []);
    if (matches.length !== 1 || matches[0].state !== "prepared" || matches[0].requestId !== request.id ||
      matches[0].requestVersion !== request.version || !sameSnapProtectedOperationBinding(matches[0], expected)) throw new Error("protected_operation_scope_changed");
    return matches[0];
  };
  const snapPreviewSchema = z.object({
    snapshot: snapApplicationSnapshotSchema, snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    dataCategories: z.array(z.enum(["household", "income"])).min(1).max(2),
    template: templateSchema, artifact: artifactSchema.extend({
      request_id: z.uuid(), request_version: z.number().int().positive(), snap_snapshot_id: z.uuid(), snap_snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
      template_id: z.literal(SNAP_PREVIEW_TEMPLATE_ID), template_version: z.literal(SNAP_PREVIEW_TEMPLATE_VERSION),
      template_hash: z.literal(SNAP_DRAFT_CONTRACT.sha256), preparation_only: z.literal(true), status: z.literal("stored"), expires_at: iso,
    }).nullable(),
  }).strict();
  const snapPreview = async () => {
    await lease();
    const raw = await rpc("select parent_private.parent_get_snap_application_preparation($1,$2,$3) as value",
      [job.jobId, job.leaseToken, request.version]);
    if (raw == null) return null;
    const state = snapPreviewSchema.parse(raw), template = state.template;
    if (state.snapshot.request_id !== request.id || template.id !== SNAP_PREVIEW_TEMPLATE_ID ||
      template.version !== SNAP_PREVIEW_TEMPLATE_VERSION || template.program_id !== "snap-pa" ||
      template.needs.length !== 1 || template.needs[0] !== "snap_new" || !template.preparation_only ||
      Object.keys(template.field_map).length || template.required_fields.length || template.personal_fields.length || template.required_acts.length ||
      template.content_sha256 !== SNAP_DRAFT_CONTRACT.sha256 || Date.parse(template.verified_until) <= now().getTime() ||
      Date.parse(template.verified_until) > Date.parse(SNAP_DRAFT_CONTRACT.verifiedUntil))
      throw new Error("snap_preview_contract_changed");
    if (state.artifact && (state.artifact.request_id !== request.id || state.artifact.request_version !== request.version ||
      state.artifact.snap_snapshot_id !== state.snapshot.id || state.artifact.snap_snapshot_hash !== state.snapshotHash ||
      Date.parse(state.artifact.expires_at) <= now().getTime())) throw new Error("snap_preview_binding_changed");
    return state;
  };
  const getCapability = async (
    programId: string,
    action: SupportAction,
    need?: SupportNeed,
  ): Promise<ServiceCapability> => {
    await lease();
    if (action === "prepare") {
      if (programId === "snap-pa" && need === "snap_new") {
        const preview = await snapPreview();
        if (preview) return {
          programId, enabled: true, actions: ["prepare"], permissionReference: null, permissionExpiresAt: null,
          dataCategories: preview.dataCategories, personalActsComplete: true, requiresForm: true, allowedFields: [], privateSnapPreview: true,
        };
      }
      const template = templateSchema.nullable().parse(await rpc(
        "select parent_private.parent_get_form_template($1,$2) as value", [programId, need ?? null],
      ));
      const enabled = !!template && template.program_id === programId && !!need &&
        template.needs.includes(need) && Date.parse(template.verified_until) > now().getTime();
      return {
        programId, enabled, actions: enabled ? ["prepare"] : [],
        permissionReference: null, permissionExpiresAt: null,
        dataCategories: request.mandate.allowedData,
        personalActsComplete: true, requiresForm: true,
        allowedFields: enabled ? [...new Set(Object.values(template.field_map))] : [],
      };
    }
    const raw = capabilitySchema.parse(
      await rpc("select parent_private.parent_get_capability($1,$2) as value", [
        programId,
        action,
      ]),
    );
    return {
      ...raw,
      // This private port reconciles its exact fax attempt; it does not register an agency-status transport.
      ...(programId === "snap-pa" && (action === "submit" || action === "follow_up")
        ? { protectedSubmissionConfigured: Boolean(options.protectedSnapSubmission) } : {}),
      ...(programId === "snap-pa" && action === "follow_up"
        ? { snapStatusTransportConfigured: typeof transports.get("snap-pa:follow_up")?.execute === "function" } : {}),
      requiresForm: raw.requiresForm ?? false,
      requiredPersonalActs: (raw.requiredActs ?? []).map((id) => ({
        id,
        title: `${getProgram(programId)?.name ?? "This program"} needs your personal step`,
        explanation:
          "The program requires your own identity check, signature or declaration. The prepared packet stays recorded; CaseLink resumes only after verified evidence for that exact packet.",
      })),
    };
  };
  const personalActsComplete = async (operation: ServiceProposedOperation) => {
    await lease();
    if (operation.protectedSnap) return (await currentProtectedOperation(operation.protectedSnap)).personalActsComplete;
    const current = z
      .array(rawOperationSchema)
      .parse(
        await rpc(
          "select parent_private.parent_get_operations($1,$2) as value",
          [job.jobId, job.leaseToken],
        ),
      );
    return current.some(
      (previous) =>
        previous.program_id === operation.programId &&
        previous.action === operation.action &&
        previous.need === operation.need &&
        previous.request_version === operation.requestVersion &&
        previous.idempotency_key === operation.idempotencyKey &&
        (previous.artifact_id ?? null) ===
          (operation.form?.artifactId ?? null) &&
        packetIdentity(previous.packet) === packetIdentity(operation.packet) &&
        previous.personalActsComplete === true,
    );
  };
  const ports: ServicePorts = {
    coordinate: async (request) => {
      if (continuationPass) return { plan: buildSupportPlan(request, now(), { snap_new: "snap-pa" }), requiredActions: [], modelCalls: 0, inputTokens: 0, outputTokens: 0 };
      if (options.continuationOnly || !options.apiKey)
        throw new DocumentProcessingError("configuration_unavailable");
      return (options.coordinate ?? coordinateSupport)({
        request,
        now: now(),
        apiKey: options.apiKey,
        fetcher,
        beforeCall,
      });
    },
    extractDocument: async (document) => {
      const raw = documentRows.get(document.id);
      if (!raw || typeof raw.object_path !== "string")
        throw new DocumentProcessingError("configuration_unavailable");
      await lease();
      const bytes = await download("parent-documents", raw.object_path);
      try {
        const result = await (options.processDocument ?? processParentDocument)(
          {
            bytes,
            mediaType: document.media_type,
            apiKey: options.apiKey ?? "",
            now: now(),
            beforeProcessing: async () => { await lease(); },
            beforeCall,
            fetcher,
          },
        );
        extracted.set(document.id, result);
        return result;
      } catch (error) {
        if (
          error instanceof DocumentProcessingError &&
          ["unreadable", "ambiguous"].includes(error.code)
        )
          await rpc(
            "select parent_private.parent_reject_document($1,$2,$3,$4) as value",
            [
              job.jobId,
              job.leaseToken,
              document.id,
              error.code === "ambiguous" ? "processing_failed" : "unreadable",
            ],
          );
        throw error;
      }
    },
    saveDocumentFacts: async (id: string, facts: ExtractedFacts, metadata) => {
      const source = extracted.get(id);
      if (!source) throw new Error("validated_document_source_unavailable");
      await lease();
      await rpc(
        "select parent_private.parent_save_document_facts($1,$2,$3,$4,$5,$6,$7) as value",
        [
          job.jobId,
          job.leaseToken,
          id,
          JSON.stringify(facts),
          financialSourcePages(source.sourcePages),
          metadata?.pageCount ?? source.pageCount,
          metadata?.sourceObservedAt ?? null,
        ],
      );
      extracted.delete(id);
    },
    capability: getCapability,
    prepareOperation: async (operation) => {
      await prepare(operation);
    },
    personalActsComplete,
    execute: async (operation) => {
      if (continuationPass && (!operation.protectedSnap || !continuations.some(known => sameSnapProtectedOperationBinding(known, operation.protectedSnap!))))
        return { state: "blocked", reason: "fresh_planning_required" };
      const capability = await getCapability(
        operation.programId,
        operation.action,
      );
      if (!capability.personalActsComplete)
        capability.personalActsComplete = await personalActsComplete(operation);
      const transport = operation.protectedSnap ? undefined : transports.get(
        `${operation.programId}:${operation.action}`,
      );
      const protectedSender = operation.protectedSnap ? options.protectedSnapSubmission : undefined;
      let transportFailed = false;
      const result = await executeSupportOperation({
        request,
        operation,
        capability,
        now: now(),
        accountActive: true,
        revoked: false,
        attempts: rawOperations.filter((operation) => operation.executed_at)
          .length,
        documentsValid: true,
        statusReferences: operations
          .filter(
            (item) =>
              item.programId === operation.programId &&
              item.need === operation.need &&
              item.receipt,
          )
          .map((item) => item.receipt!.reference),
        store: {
          prepare: async () => prepare(operation),
          begin: async (operationId) => {
            await lease();
            const schema = z
              .object({
                operationId: z.uuid(),
                programId: z.string(),
                need: needSchema,
                action: z.string(),
                idempotencyKey: z.string(),
                packet: z.record(z.string(), z.unknown()),
                packetHash: z.string().regex(/^[a-f0-9]{64}$/),
                permissionVersion: z.string().optional(),
                protectedPacket: snapProtectedReferenceSchema.nullable().optional(),
                artifact: artifactSchema.nullable().optional(),
              });
            const frozen = (operation.protectedSnap ? schema.strict() : schema.passthrough()).parse(
                await rpc(
                  "select parent_private.parent_begin_operation($1,$2,$3) as value",
                  [operationId, job.jobId, job.leaseToken],
                ),
              );
            if (
              frozen.operationId !== operationId ||
              frozen.programId !== operation.programId ||
              frozen.need !== operation.need ||
              frozen.action !== operation.action ||
              frozen.idempotencyKey !== operation.idempotencyKey
            )
              throw new Error("frozen_operation_scope_changed");
            if (operation.protectedSnap && (frozen.artifact != null || frozen.packetHash !== operation.protectedSnap.packetHash ||
              frozen.permissionVersion !== operation.protectedSnap.permissionVersion ||
              !sameSnapProtectedPacket(frozen.packet, operation.protectedSnap.packet) ||
              !sameSnapProtectedPacket({ protectedSnapPacket: frozen.protectedPacket }, operation.protectedSnap.packet)))
              throw new Error("frozen_protected_operation_changed");
            return frozen;
          },
          finish: async (operationId, state, evidence) => {
            await rpc(
              "select parent_private.parent_finish_operation($1,$2,$3,$4,$5,$6) as value",
              [
                operationId,
                job.jobId,
                job.leaseToken,
                state,
                JSON.stringify(evidence),
                null,
              ],
            );
          },
        },
        readiness: {
          requiredFields: (operation.form?.missingFields ?? []).map(
            (field) => ({
              field,
              label: field,
              present: false,
              source: "unverified" as const,
              verifiedAt: null,
              validUntil: null,
              conflicted: false,
            }),
          ),
          formVerified:
            operation.protectedSnap?.protectedPacketCurrent === true ||
            operation.action === "follow_up" ||
            !capability.requiresForm ||
            Boolean(
              operation.form?.validated &&
              operation.form.artifactId &&
              operation.form.contentSha256 &&
              !operation.form.missingFields.length,
            ),
        },
        transport: protectedSender && operation.protectedSnap ? {
          execute: async frozen => {
            await lease();
            const canonical = operation.protectedSnap!;
            if (frozen.operationId !== canonical.operationId || frozen.packetHash !== canonical.packetHash || !sameSnapProtectedPacket(frozen.packet, canonical.packet))
              throw new Error("protected_operation_scope_changed");
            const result = snapProtectedSubmissionResultSchema.parse(await protectedSender.execute(protectedIntent(canonical, frozen.signal)));
            if (result.operationId !== canonical.operationId || result.packetId !== canonical.packet.protectedSnapPacket.packetId ||
              result.contentSha256 !== canonical.packet.protectedSnapPacket.contentSha256) throw new Error("protected_delivery_unconfirmed");
            if (!("receipt" in result)) {
              transportFailed = result.transportStatus === "FAILURE";
              throw new Error("protected_delivery_unconfirmed");
            }
            return result.receipt;
          },
        } : transport
          ? {
              execute: async (frozen) => {
                const artifact = (
                  frozen as ExecutablePacket & {
                    artifact?: RuntimeArtifact | null;
                  }
                ).artifact;
                let attachment:
                  { metadata: RuntimeArtifact; bytes: Uint8Array } | undefined;
                if (artifact) {
                  const bytes = await download(
                    "parent-form-artifacts",
                    artifact.object_path,
                  );
                  if (digest(bytes) !== artifact.content_sha256)
                    throw new Error("frozen_form_bytes_changed");
                  attachment = { metadata: artifact, bytes };
                }
                const documents: {
                  id: string;
                  mediaType: string;
                  bytes: Uint8Array;
                }[] = [];
                for (const id of z
                  .array(z.uuid())
                  .max(10)
                  .parse(frozen.packet.documentIds ?? [])) {
                  const document = documentRows.get(id);
                  if (
                    !document ||
                    typeof document.object_path !== "string" ||
                    typeof document.media_type !== "string"
                  )
                    throw new Error("frozen_attachment_unavailable");
                  documents.push({
                    id,
                    mediaType: document.media_type,
                    bytes: await download(
                      "parent-documents",
                      document.object_path,
                    ),
                  });
                }
                // The broker rechecks the live lease/consent for every attachment. Final grant check precedes delivery.
                await lease();
                return transport.execute({
                  ...frozen,
                  programId: operation.programId,
                  need: operation.need,
                  action: operation.action,
                  ...(attachment ? { artifact: attachment } : {}),
                  ...(documents.length ? { documents } : {}),
                });
              },
            }
          : undefined,
      });
      if (
        !["blocked", "delivery_unknown"].includes(result.state) &&
        !receiptSchema.safeParse(result.receipt).success
      )
        throw new Error("unattributed_execution_result");
      return { ...result, ...(transportFailed && result.state === "delivery_unknown" ? { transportStatus: "FAILURE" as const } : {}) } as Awaited<ReturnType<ServicePorts["execute"]>>;
    },
    reconcile: async (operation) => {
      if (continuationPass && (!operation.protectedSnap || !continuations.some(known => sameSnapProtectedOperationBinding(known, operation.protectedSnap!)))) return null;
      const protectedPacket = Object.hasOwn(operation.packet, "protectedSnapPacket");
      const transport = protectedPacket ? undefined : transports.get(`${operation.programId}:follow_up`);
      const protectedSender = protectedPacket ? options.protectedSnapSubmission : undefined;
      if (protectedPacket ? !protectedSender || !operation.protectedSnap || operation.protectedSnap.requestId !== request.id : !transport?.reconcile) return null;
      const current = await getCapability(operation.programId, "follow_up");
      if (
        !current.enabled ||
        !current.actions.includes("follow_up") ||
        !current.permissionReference ||
        !current.permissionExpiresAt ||
        Date.parse(current.permissionExpiresAt) <= now().getTime() ||
        !request.mandate.allowedData.includes("household") ||
        !current.dataCategories.includes("household")
      )
        return null;
      await lease();
      let observed: unknown;
      if (protectedPacket) {
        const canonical = operation.protectedSnap!;
        const value = await protectedSender!.reconcile(protectedIntent(canonical, AbortSignal.timeout(60000)));
        if (value === null) return null;
        const result = snapProtectedSubmissionResultSchema.parse(value);
        if (result.operationId !== canonical.operationId || result.packetId !== canonical.packet.protectedSnapPacket.packetId ||
          result.contentSha256 !== canonical.packet.protectedSnapPacket.contentSha256) throw new Error("protected_reconciliation_scope_changed");
        if (!("receipt" in result)) return result.transportStatus === "FAILURE" ? { state: "delivery_unknown", transportStatus: "FAILURE" } : null;
        observed = result.receipt;
      } else observed = await transport!.reconcile!(
          {
            id: operation.id,
            need: operation.need,
            programId: operation.programId,
            idempotencyKey: operation.idempotencyKey,
          },
          AbortSignal.timeout(60000),
        );
      const receipt = receiptSchema.parse(observed);
      await rpc(
        "select parent_private.parent_reconcile_operation($1,$2,$3,$4,$5) as value",
        [
          job.jobId,
          job.leaseToken,
          operation.id,
          receipt.state,
          JSON.stringify(receipt),
        ],
      );
      return receipt;
    },
    fillForm: async (programId, packet, need): Promise<ServiceForm | null> => {
      if (continuationPass) return null;
      await lease();
      if (programId === "snap-pa" && need === "snap_new") {
        const preview = await snapPreview();
        if (preview) {
          const { snapshot, readiness } = assessSnapApplicationSnapshot(preview.snapshot, now());
          if (!readiness.sourceReviewCurrent) throw new Error("snap_preview_source_expired");
          const metadata = {
            snapshotId: snapshot.id, snapshotHash: preview.snapshotHash,
            state: "ready" as "ready" | "needs_current_facts" | "service_blocked",
            missingFields: readiness.missingFields, invalidCurrentFields: readiness.invalidCurrentFields, staleFields: readiness.staleFields,
            serviceQuestions: readiness.serviceQuestions, renderingRequirements: [] as string[], dataCategories: preview.dataCategories,
          };
          const common = {
            programId, templateId: preview.template.id, version: preview.template.version,
            formInputDigest: digest(JSON.stringify(packet)), validated: true as const, preparationOnly: true,
            personalActs: [], missingFields: [] as string[], snapApplication: metadata,
          };
          if (programRoutingIssue(getProgram("snap-pa")!, undefined, now())) return { ...common,
            snapApplication: { ...metadata, state: "service_blocked", serviceQuestions: [...metadata.serviceQuestions, "program_source_review"] } };
          if (!readiness.nonProtectedDataReadyForReview) return { ...common, missingFields: ["snap_application_details"],
            snapApplication: { ...metadata, state: "needs_current_facts" } };
          if (programRoutingIssue(getProgram("snap-pa")!, snapshot.details.zip, now())) return { ...common,
            snapApplication: { ...metadata, state: "service_blocked", serviceQuestions: [...metadata.serviceQuestions, "service_area_review"] } };
          if (preview.artifact) return { ...common, artifactId: preview.artifact.id, contentSha256: preview.artifact.content_sha256 };
          const source = await download("parent-known-forms", preview.template.object_path);
          const rendered = await renderSnapApplicationPreview(source, snapshot.details, now());
          if (!rendered.bytes) return { ...common, snapApplication: { ...metadata, state: "service_blocked",
            renderingRequirements: rendered.readiness.renderingRequirements } };
          const artifact = artifactSchema.parse(await rpc(
            "select parent_private.parent_register_snap_application_preview($1,$2,$3,$4,$5,$6) as value",
            [job.jobId, job.leaseToken, request.version, snapshot.id, preview.snapshotHash, digest(rendered.bytes)]));
          await upload(artifact, rendered.bytes);
          return { ...common, artifactId: artifact.id, contentSha256: artifact.content_sha256 };
        }
      }
      const raw = await rpc(
        "select parent_private.parent_get_form_template($1,$2) as value",
        [programId, need ?? null],
      );
      if (!raw) return null;
      const template = templateSchema.parse(raw);
      if (
        template.program_id !== programId ||
        !need ||
        !template.needs.includes(need) ||
        Date.parse(template.verified_until) <= now().getTime()
      )
        throw new Error("form_purpose_changed");
      if (template.preparation_only && !request.mandate.allowedActions.includes("prepare"))
        throw new Error("form_preparation_not_authorized");
      const snapDraft = template.id === SNAP_DRAFT_CONTRACT.id;
      if (snapDraft && (programId !== "snap-pa" || need !== "snap_new" ||
        template.version !== SNAP_DRAFT_CONTRACT.version ||
        template.content_sha256 !== SNAP_DRAFT_CONTRACT.sha256 || !template.preparation_only ||
        now().getTime() < Date.parse(`${SNAP_DRAFT_CONTRACT.sourceCheckedAt}T00:00:00Z`) ||
        now().getTime() >= Date.parse(SNAP_DRAFT_CONTRACT.verifiedUntil) ||
        Date.parse(template.verified_until) > Date.parse(SNAP_DRAFT_CONTRACT.verifiedUntil) ||
        Object.values(template.field_map).some(field => field !== "zip") ||
        Object.keys(packet).some(field => field !== "zip")))
        throw new Error("snap_preparation_contract_changed");
      const formInputDigest = digest(JSON.stringify(packet));
      const personalActs = template.required_acts.map((id) => ({
        id,
        title: `${getProgram(programId)?.name ?? "This program"} needs your personal step`,
        explanation:
          "Complete the program’s required personal step using the prepared exact packet. CaseLink does not create your signature or declaration.",
      }));
      const missingFields = template.required_fields.filter(
        (field) => packet[field] === undefined || packet[field] === null,
      );
      const common = {
        programId,
        templateId: template.id,
        version: template.version,
        formInputDigest,
        validated: true as const,
        preparationOnly: template.preparation_only,
        personalActs,
        missingFields,
      };
      if (missingFields.length) return common;
      const previous = await rpc(
        "select parent_private.parent_get_form_artifact($1,$2,$3,$4,$5,$6,$7) as value",
        [
          job.jobId,
          job.leaseToken,
          programId,
          need,
          template.id,
          template.version,
          JSON.stringify(packet),
        ],
      );
      if (previous) {
        const artifact = artifactSchema.parse(previous);
        return {
          ...common,
          artifactId: artifact.id,
          contentSha256: artifact.content_sha256,
        };
      }
      const contract: VerifiedFormContract = {
        programId,
        templateId: template.id,
        version: template.version,
        templateSha256: template.content_sha256,
        verifiedUntil: template.verified_until,
        fields: template.field_map,
        requiredFields: template.required_fields,
        personalFields: template.personal_fields,
      };
      const source = await download("parent-known-forms", template.object_path);
      let bytes: Uint8Array;
      if (snapDraft) {
        const draft = await renderSnapPreparationDraft(source, {
          kind: "current_scoped_facts", zip: packet.zip, language: request.intake.language,
        }, now());
        bytes = draft.bytes;
      } else bytes = await fillVerifiedForm(contract, source, packet, now());
      const artifact = artifactSchema.parse(
        await rpc(
          "select parent_private.parent_register_form_artifact($1,$2,$3,$4,$5,$6,$7,$8) as value",
          [
            job.jobId,
            job.leaseToken,
            programId,
            template.id,
            template.version,
            JSON.stringify(packet),
            digest(bytes),
            need,
          ],
        ),
      );
      await upload(artifact, bytes);
      return {
        ...common,
        artifactId: artifact.id,
        contentSha256: artifact.content_sha256,
      };
    },
    notify: async (event) => {
      await lease();
      await rpc(
        "select parent_private.parent_record_service_event($1,$2,$3) as value",
        [job.jobId, job.leaseToken, JSON.stringify(event)],
      );
    },
  };
  try {
    const result = await runSupportService({
      request: serviceRequest,
      documents: continuation ? [] : job.documents.map(normalizeDocument),
      operations,
      jobAttempts: deliveryJobAttempts,
      ...(snapCapture && !continuation ? { snapCapture } : {}),
      now: now(),
      ports,
    });
    const otherNeeds = request.intake.needs.filter(need => need !== "snap_new");
    if (continuation && otherNeeds.length) {
      let otherRoutes = (request.plan?.routes ?? []).filter(route => route.need !== "snap_new");
      let otherActions = request.required_actions.filter(action => action.need !== "snap_new");
      let retryDriver = true;
      if (options.apiKey && !options.continuationOnly) {
        continuationPass = false;
        try {
          const other = await runSupportService({
            request: { ...request, intake: { ...request.intake, needs: otherNeeds }, required_actions: otherActions,
              plan: request.plan ? { ...request.plan, routes: otherRoutes } : null },
            documents: job.documents.map(normalizeDocument),
            operations: operations.filter(operation => operation.need !== "snap_new"), now: now(), ports,
          });
          otherRoutes = other.plan.routes; otherActions = other.requiredActions; retryDriver = false;
          result.modelCalls += other.modelCalls; result.inputTokens += other.inputTokens; result.outputTokens += other.outputTokens;
          result.plan.model = other.plan.model ?? result.plan.model;
          if (other.nextRunAt && (!result.nextRunAt || Date.parse(other.nextRunAt) < Date.parse(result.nextRunAt))) {
            result.nextRunAt = other.nextRunAt; result.nextActor = other.nextActor; result.nextTrigger = other.nextTrigger;
          } else if (!result.nextRunAt && other.nextActor) {
            result.nextActor = other.nextActor; result.nextTrigger = other.nextTrigger;
          }
        } catch {
          // Independent planning cannot roll back a recorded SNAP result or erase its saved sibling work.
          retryDriver = true;
        }
      }
      const snapRoutes = result.plan.routes;
      result.plan.routes = request.intake.needs.flatMap(need => (need === "snap_new" ? snapRoutes : otherRoutes).filter(route => route.need === need));
      result.requiredActions = [...otherActions, ...result.requiredActions];
      const next = now().getTime() + 300_000;
      if (retryDriver && next < Date.parse(request.mandate.expiresAt)) {
        result.nextRunAt = new Date(Math.min(next, Date.parse(result.nextRunAt ?? "") || Infinity)).toISOString();
        result.nextTrigger = "scheduled_follow_up";
        result.nextActor = "caselink";
      }
      if (result.requiredActions.some(action => !action.resolved && (!action.resolver || action.resolver === "parent"))) result.nextActor = "parent";
    }
    if (request.controlled_test && request.intake.needs.length === 1 && request.intake.needs[0] === "snap_new") {
      const completed = (await loadOperations()).filter(operation => operation.request_version === request.version).map(normalizeWorkerOperation).some(operation =>
        operation?.programId === "snap-pa" && operation.action === "submit" &&
        operation.receipt?.source === "provider_api" && operation.receipt.state === "sent" && operation.receipt.reference.startsWith("sinch-emulation:"));
      if (completed) {
        result.nextRunAt = null;
        result.nextActor = null;
        result.nextTrigger = "none";
        result.plan.summary = "The fictional signing and fax test is complete. No application was filed with DHS.";
      }
    }
    if (deliveryJobAttempts === 48 && result.nextRunAt) {
      result.nextRunAt = null;
      if (result.nextActor !== "parent") result.nextActor = "operator";
      result.nextTrigger = result.nextActor === "parent" ? "parent_action_completed" : "route_review_required";
    }
    await rpc(
      "select parent_private.parent_save_job_plan($1,$2,$3,$4,$5,$6,$7,$8) as value",
      [
        job.jobId,
        job.leaseToken,
        request.version,
        JSON.stringify(result.plan),
        JSON.stringify(result.requiredActions),
        result.nextRunAt,
        result.nextActor,
        result.nextTrigger,
      ],
    );
    return { state: "saved" };
  } catch (error) {
    const reason =
      error instanceof DocumentProcessingError
        ? error.code === "configuration_unavailable"
          ? "configuration_unavailable"
          : "ai_unavailable"
        : error instanceof Error && error.message === "ai_budget_exhausted"
          ? "ai_budget_exhausted"
          : "execution_error";
    try {
      await rpc("select parent_private.parent_fail_job($1,$2,$3,$4) as value", [
        job.jobId,
        job.leaseToken,
        reason,
        null,
      ]);
    } catch {
      /* A revoked or expired lease cannot authorize further writes. */
    }
    return { state: "failed", reason };
  } finally {
    extracted.clear();
  }
}
