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
  intakeSchema,
  mandateSchema,
  needSchema,
  type SupportAction,
  type SupportIntake,
  type ServiceMandate,
  type SupportRequest,
} from "./domain";
import { executeSupportOperation, type ExecutablePacket } from "./execution";
import { fillVerifiedForm, type VerifiedFormContract } from "./forms";
import { receiptSchema } from "./policy";
import { canonicalProjectOrigin } from "./project-origin";
import { getProgram } from "./programs";
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
  brokerOrigin: string;
  brokerSecret: string;
  supabaseOrigin: string;
  transports?: ReadonlyMap<string, RuntimeTransport>;
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
    evidence: z.record(z.string(), z.unknown()).nullable().optional(),
    personalActsComplete: z.boolean().optional(),
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
      intake: intakeSchema,
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
  });
  const state = receipt.success
    ? receipt.data.state
    : operation.state === "delivery_unknown"
      ? "delivery_unknown"
      : operation.state === "prepared"
        ? "prepared"
        : null;
  if (!state) return null;
  return {
    id: operation.id,
    need: operation.need,
    programId: operation.program_id,
    action: operation.action,
    state,
    idempotencyKey: operation.idempotency_key,
    packet: operation.packet,
    updatedAt: operation.updated_at,
    ...(receipt.success ? { receipt: receipt.data } : {}),
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
    "select parent_private.parent_claim_job($1) as job",
    [300],
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
    if (
      url.origin !== supabaseOrigin ||
      !url.pathname.startsWith("/storage/v1/object/")
    )
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
  const rawOperations = z
    .array(rawOperationSchema)
    .parse(
      await rpc("select parent_private.parent_get_operations($1,$2) as value", [
        job.jobId,
        job.leaseToken,
      ]),
    );
  const operations = rawOperations
    .map(normalizeWorkerOperation)
    .filter((operation): operation is ServiceOperation => operation !== null);
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
    await lease();
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
  const getCapability = async (
    programId: string,
    action: SupportAction,
  ): Promise<ServiceCapability> => {
    await lease();
    const raw = capabilitySchema.parse(
      await rpc("select parent_private.parent_get_capability($1,$2) as value", [
        programId,
        action,
      ]),
    );
    return {
      ...raw,
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
    coordinate: async (intake: SupportIntake, mandate: ServiceMandate) => {
      if (!options.apiKey)
        throw new DocumentProcessingError("configuration_unavailable");
      return (options.coordinate ?? coordinateSupport)({
        intake,
        mandate,
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
            beforeProcessing: lease,
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
    preparePersonalStep: async (operation) => {
      await prepare(operation);
    },
    personalActsComplete,
    execute: async (operation) => {
      const capability = await getCapability(
        operation.programId,
        operation.action,
      );
      if (!capability.personalActsComplete)
        capability.personalActsComplete = await personalActsComplete(operation);
      const transport = transports.get(
        `${operation.programId}:${operation.action}`,
      );
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
            const frozen = z
              .object({
                operationId: z.uuid(),
                programId: z.string(),
                need: needSchema,
                action: z.string(),
                idempotencyKey: z.string(),
                packet: z.record(z.string(), z.unknown()),
                packetHash: z.string().regex(/^[a-f0-9]{64}$/),
                artifact: artifactSchema.nullable().optional(),
              })
              .passthrough()
              .parse(
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
        transport: transport
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
      return result as Awaited<ReturnType<ServicePorts["execute"]>>;
    },
    reconcile: async (operation) => {
      const transport = transports.get(`${operation.programId}:follow_up`);
      if (!transport?.reconcile) return null;
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
      const receipt = receiptSchema.parse(
        await transport.reconcile(
          {
            id: operation.id,
            need: operation.need,
            programId: operation.programId,
            idempotencyKey: operation.idempotencyKey,
          },
          AbortSignal.timeout(60000),
        ),
      );
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
      await lease();
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
      const bytes = await fillVerifiedForm(
        contract,
        await download("parent-known-forms", template.object_path),
        packet,
        now(),
      );
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
      request,
      documents: job.documents.map(normalizeDocument),
      operations,
      now: now(),
      ports,
    });
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
