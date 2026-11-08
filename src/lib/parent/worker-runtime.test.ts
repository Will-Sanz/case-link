import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { DocumentProcessingError } from "./document-processing";
import { buildSupportPlan, requiredActions } from "./planning";
import {
  fixtureIntake,
  fixtureMandate,
  fixtureNow,
  fixtureRequest,
  fixtureSnapSnapshot,
  fixtureProtectedSnapOperation,
  fixtureSnapCaptureIntent,
} from "./test-fixtures";
import {
  normalizeWorkerOperation,
  PARENT_TRANSPORTS,
  runOneParentJob,
  type RuntimeTransport,
  type WorkerRuntimeOptions,
} from "./worker-runtime";
import { SNAP_DRAFT_CONTRACT } from "./snap-draft";
import { SNAP_PREVIEW_TEMPLATE_ID, SNAP_PREVIEW_TEMPLATE_VERSION } from "./snap-application-snapshot";
import type { SnapCapturePreparationPort } from "./snap-pending-capture";
import { sealSnapFinalPacket, snapFinalPacketAad, type SnapFinalPacketBinding } from "./snap-final-packet";
import * as finalPdfInspection from "./snap-final-pdf";
import { createSnapProtectedDelivery, createSnapProtectedSenderHandler } from "./snap-sender-service";
import { createSnapProtectedSubmissionClient } from "./snap-sender-worker-client";
import { snapSenderAttemptSchema, type SnapSenderAttempt } from "./snap-sender-contract";
import type { SnapSenderStore } from "./snap-sender-store";
import type { SnapSenderCarrier } from "./snap-sender-carrier";
import type { SnapProtectedSubmissionPort } from "./snap-protected-submission-port";

const jobId = "d1b9b24b-591f-4917-8d8c-46273f5ffbc7",
  leaseToken = "f2027908-9548-4b72-8657-4014ea7e8145",
  operationId = "467931e4-f88c-479b-8dcf-13f8ac397051",
  documentId = "d0f16fce-53e5-4dde-be9b-9feb85847fa4",
  artifactId = "3678e816-307a-46b0-83b2-cc48ac687d21";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const receipt = {
  state: "sent",
  source: "provider_api",
  reference: "synthetic-reference",
  recordedAt: fixtureNow.toISOString(),
};
function setup() {
  const request = fixtureRequest({
    intake: fixtureIntake({ needs: ["electricity"] }),
    mandate: fixtureMandate({ recipientIds: ["peco-cap"] }),
  });
  const state = {
    claim: {
      jobId,
      leaseToken,
      request,
      documents: [] as Record<string, unknown>[],
    },
    noJob: false,
    operations: [] as Record<string, unknown>[],
    pendingCapture: null as unknown,
    pendingReadFailure: false,
    prepared: [] as unknown[][],
    privatePrepared: [] as unknown[][],
    finished: [] as unknown[][],
    events: [] as unknown[],
    saved: [] as unknown[][],
    capabilityEnabled: true,
    requiredActs: [] as string[],
    allowedFields: [
      "zip",
      "householdSize",
      "utilityProvider",
      "accountAuthority",
      "amountDue",
      "totalBalance",
      "dueDate",
      "documentIds",
    ],
    template: null as Record<string, unknown> | null,
    templateBytes: new Uint8Array() as Uint8Array,
    previousArtifact: null as Record<string, unknown> | null,
    preview: null as Record<string, unknown> | null,
    previewRegisterDenied: false,
    previewPrepareDenied: false,
    artifact: null as Record<string, unknown> | null,
    uploaded: new Uint8Array() as Uint8Array,
    source: new Uint8Array([37, 80, 68, 70, 45, 49]),
    budget: true,
    revoked: false,
    badDownloadOrigin: false,
    s3Download: false,
    protectedFrozenChange: {} as Record<string, unknown>,
    badDownloadPath: false,
    leaseExpiresAt: "2026-10-25T16:05:00Z",
    deliveryJobAttempts: 1 as number | null,
  };
  const database = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      const fn = text.match(/parent_private\.(\w+)/)?.[1];
      let value: unknown = null;
      switch (fn) {
        case "parent_claim_job":
          return { rows: [{ job: state.noJob ? null : state.claim }] };
        case "parent_renew_job_lease":
          if (state.revoked) throw new Error("authority_changed");
          value = state.leaseExpiresAt;
          break;
        case "parent_get_operations":
          value = state.operations;
          break;
        case "parent_get_snap_delivery_job_attempts":
          value = state.deliveryJobAttempts;
          break;
        case "parent_get_snap_pending_capture":
          if (state.pendingReadFailure) throw new Error("PRIVATE_METADATA_CANARY");
          value = state.pendingCapture;
          break;
        case "parent_reserve_ai_call":
          value = state.budget;
          break;
        case "parent_get_capability":
          value = {
            programId: values[0],
            enabled: state.capabilityEnabled,
            actions: state.capabilityEnabled ? [values[1]] : [],
            permissionReference: "synthetic-partner-contract",
            permissionVersion: "synthetic-permission",
            permissionExpiresAt: "2026-11-20T00:00:00Z",
            dataCategories: ["household", "income", "utility", "documents"],
            personalActsComplete: !state.requiredActs.length,
            requiredActs: state.requiredActs,
            allowedFields: state.allowedFields,
            requiresForm: !!state.template,
          };
          break;
        case "parent_get_form_template":
          value = state.template;
          break;
        case "parent_get_form_artifact":
          value = state.previousArtifact;
          break;
        case "parent_get_snap_application_preparation":
          value = state.preview;
          break;
        case "parent_register_snap_application_preview":
          if (state.previewRegisterDenied) throw new Error("SNAP preparation changed");
          state.artifact = { id: artifactId, object_path: `${request.id}/${artifactId}.pdf`, content_sha256: values[5] };
          value = state.artifact;
          break;
        case "parent_register_form_artifact":
          state.artifact = {
            id: artifactId,
            object_path: `${request.id}/${artifactId}.pdf`,
            content_sha256: values[6],
          };
          value = state.artifact;
          break;
        case "parent_prepare_operation":
          state.prepared.push(values);
          value = state.operations.some(operation => operation.id === operationId) ? artifactId : operationId;
          break;
        case "parent_prepare_snap_application_preview":
          if (state.previewPrepareDenied) throw new Error("SNAP preparation changed");
          state.privatePrepared.push(values); value = operationId;
          break;
        case "parent_begin_operation": {
          const canonical = state.operations.find(operation => operation.id === values[0] && Object.hasOwn(operation.packet as object, "protectedSnapPacket"));
          if (canonical) {
            value = { operationId: canonical.id, packet: canonical.packet, packetHash: canonical.packet_hash, idempotencyKey: canonical.idempotency_key,
              programId: canonical.program_id, need: canonical.need, action: canonical.action, permissionVersion: canonical.permission_version,
              artifact: canonical.artifact_id, protectedPacket: (canonical.packet as { protectedSnapPacket: unknown }).protectedSnapPacket, ...state.protectedFrozenChange };
            break;
          }
          const prepared = state.prepared.at(-1)!;
          value = {
            operationId: values[0],
            packet: JSON.parse(String(prepared[5])),
            packetHash: "a".repeat(64),
            idempotencyKey: prepared[8],
            programId: prepared[3],
            action: prepared[4],
            need: prepared[9],
            artifact: prepared[10]
              ? (state.artifact ?? state.previousArtifact)
              : null,
          };
          break;
        }
        case "parent_finish_operation":
          state.finished.push(values);
          break;
        case "parent_record_service_event":
          state.events.push(JSON.parse(String(values[2])));
          break;
        case "parent_save_job_plan":
          state.saved.push(values);
          break;
      }
      return { rows: [{ value }] };
    }),
  };
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3310/objects") {
        const purpose = JSON.parse(String(init?.body));
        return Response.json(
          purpose.mode === "upload"
            ? {
                signedUrl: "http://127.0.0.1:3310/uploads",
                token: "synthetic-short-grant",
              }
            : {
                signedUrl: `${state.badDownloadOrigin ? "https://unexpected.example" : "http://127.0.0.1:55321"}/storage/v1/${state.s3Download ? "s3" : "object/sign"}/${purpose.bucket}/${state.badDownloadPath ? "another-household.pdf" : purpose.objectPath}?token=synthetic`,
              },
        );
      }
      if (url === "http://127.0.0.1:3310/uploads") {
        state.uploaded = new Uint8Array(Buffer.from(init?.body as Uint8Array));
        return Response.json({ ok: true });
      }
      if (url.includes("/parent-known-forms/"))
        return new Response(Buffer.from(state.templateBytes));
      if (url.includes("/parent-form-artifacts/"))
        return new Response(Buffer.from(state.uploaded));
      if (url.includes("/parent-documents/"))
        return new Response(Buffer.from(state.source));
      throw new Error("Unregistered synthetic request");
    },
  );
  const execute = vi.fn<RuntimeTransport["execute"]>(async () => receipt);
  const options: WorkerRuntimeOptions = {
    database,
    apiKey: "synthetic-not-a-real-key",
    brokerOrigin: "http://127.0.0.1:3310",
    brokerSecret: "synthetic-broker-secret-with-32-characters",
    supabaseOrigin: "http://127.0.0.1:55321",
    fetcher: fetcher as typeof fetch,
    now: () => fixtureNow,
    transports: new Map([
      ["peco-cap:submit", { execute }],
      ["peco-cap:follow_up", { execute }],
    ]),
    coordinate: async (input) => {
      await input.beforeCall?.();
      return {
        plan: buildSupportPlan(input.request, fixtureNow),
        requiredActions: requiredActions(input.request.intake, input.request.mandate),
        modelCalls: 1,
        inputTokens: 10,
        outputTokens: 10,
      };
    },
  };
  return { state, options, database, fetcher, execute };
}
function uploadFixture(test: ReturnType<typeof setup>) {
  test.state.claim.documents = [
    {
      id: documentId,
      request_id: test.state.claim.request.id,
      filename: "synthetic.pdf",
      media_type: "application/pdf",
      size_bytes: 6,
      status: "uploaded",
      expires_at: "2026-11-01T00:00:00Z",
      created_at: fixtureNow.toISOString(),
      consent_version: "2026-10-25",
      object_path: `${test.state.claim.request.household_id}/${test.state.claim.request.id}/${documentId}`,
      facts: [],
    },
  ];
  test.options.processDocument = vi.fn<
    NonNullable<WorkerRuntimeOptions["processDocument"]>
  >(async (input) => {
    await input.beforeProcessing();
    await input.beforeCall();
    return {
      facts: {
        provider: "peco",
        amountDue: 50,
        totalBalance: null,
        dueDate: "2026-11-01",
        shutoffDate: null,
        fields: [
          { field: "provider", page: 1, sourceText: "PECO" },
          { field: "amountDue", page: 1, sourceText: "Amount due $50.00" },
          { field: "dueDate", page: 1, sourceText: "Due date 2026-11-01" },
        ],
      },
      sourcePages: [
        "Private name\nPECO\nAmount due $50.00\nDue date 2026-11-01\nStatement date 2026-10-20",
      ],
      pageCount: 1,
      sourceObservedAt: "2026-10-20",
      inputTokens: 10,
      outputTokens: 10,
    };
  });
}
async function formFixture(test: ReturnType<typeof setup>) {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const form = pdf.getForm();
  form.createTextField("ZIP");
  form.createTextField("Amount");
  test.state.templateBytes = await pdf.save();
  test.state.allowedFields = ["zip", "amountDue"];
  test.state.template = {
    id: "synthetic-current-form",
    version: "1",
    program_id: "peco-cap",
    needs: ["electricity"],
    content_sha256: hash(test.state.templateBytes),
    object_path: "synthetic/template.pdf",
    field_map: { ZIP: "zip", Amount: "amountDue" },
    required_acts: [],
    required_fields: ["zip", "amountDue"],
    personal_fields: [],
    verified_until: "2026-11-20T00:00:00Z",
    active: true,
  };
  test.state.claim.request.facts = [
    {
      need: "electricity",
      field: "amountDue",
      value: 50,
      source: "parent",
      confirmedAt: fixtureNow.toISOString(),
      asOf: "2026-10-25",
    },
  ];
}

describe("isolated parent worker runtime", () => {
  async function snapDraftFixture() {
    const test = setup();
    const now = new Date("2026-11-03T22:00:00Z");
    test.options.now = () => now;
    test.state.leaseExpiresAt = "2026-11-03T22:05:00Z";
    test.state.claim.request.intake = fixtureIntake({ needs: ["snap_new"], language: "es" });
    test.state.claim.request.mandate = fixtureMandate({ mode: "prepare_only", recipientIds: ["snap-pa"], allowedActions: ["research", "prepare"] });
    test.state.capabilityEnabled = false;
    test.options.transports = new Map();
    test.state.templateBytes = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf");
    test.state.template = {
      id: SNAP_DRAFT_CONTRACT.id, version: SNAP_DRAFT_CONTRACT.version,
      program_id: "snap-pa", needs: ["snap_new"], content_sha256: SNAP_DRAFT_CONTRACT.sha256,
      object_path: "snap-pa/official.pdf", field_map: { ZIP: "zip" }, required_acts: [],
      required_fields: ["zip"], personal_fields: [], verified_until: SNAP_DRAFT_CONTRACT.verifiedUntil,
      active: true, preparation_only: true,
    };
    return test;
  }
  it("automatically fills and privately stores the pinned official SNAP draft using only current scoped fields", async () => {
    const test = await snapDraftFixture();
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect((await PDFDocument.load(test.state.uploaded)).getPageCount()).toBe(12);
    expect(test.state.prepared).toHaveLength(1);
    expect(test.state.prepared[0][4]).toBe("prepare");
    expect(JSON.parse(String(test.state.prepared[0][5]))).toEqual({ zip: "19104" });
    expect(test.state.artifact?.content_sha256).toBe(hash(test.state.uploaded));
    expect(JSON.parse(String(test.state.saved[0][3])).routes[0].limitation).toContain("incomplete unsigned draft");
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.state.finished).toEqual([]);
  });
  it.each([false, true])("rejects preparation outside the mandate before artifact creation or reuse (stored: %s)", async (stored) => {
    const test = await snapDraftFixture();
    test.state.claim.request.mandate = fixtureMandate({ recipientIds: ["snap-pa"], allowedActions: ["submit"] });
    test.state.capabilityEnabled = true;
    test.state.allowedFields = ["zip"];
    test.options.transports = new Map([["snap-pa:submit", { execute: test.execute }]]);
    if (stored) test.state.previousArtifact = { id: artifactId, object_path: "old.pdf", content_sha256: "a".repeat(64) };
    await runOneParentJob(test.options);
    expect(test.database.query.mock.calls.some(([sql]) => /parent_get_form_artifact|parent_register_form_artifact/.test(sql))).toBe(false);
    expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.state.prepared).toEqual([]);
    expect(test.execute).not.toHaveBeenCalled();
  });
  it.each(["preparation scope", "template review", "field mapping"])("rejects a changed SNAP %s before reusing a stored artifact", async (change) => {
    const test = await snapDraftFixture();
    test.state.previousArtifact = { id: artifactId, object_path: "old.pdf", content_sha256: "a".repeat(64) };
    if (change === "preparation scope") test.state.template!.preparation_only = false;
    if (change === "template review") test.state.template!.verified_until = "2026-12-04T00:00:00Z";
    if (change === "field mapping") test.state.template!.field_map = { ZIP: "zip", Income: "incomeAmount" };
    await runOneParentJob(test.options);
    expect(test.state.prepared).toEqual([]);
    expect(test.state.uploaded).toHaveLength(0);
    expect(test.execute).not.toHaveBeenCalled();
  });
  it.each(["prepare_only", "full"] as const)("stores an exact verified form under %s permission while all external transports stay disabled", async (mode) => {
    const test = setup();
    await formFixture(test);
    test.state.claim.request.mandate = fixtureMandate({ mode, recipientIds: ["peco-cap"],
      allowedActions: mode === "prepare_only" ? ["research", "prepare"] : ["research", "prepare", "submit"] });
    test.state.capabilityEnabled = false;
    test.options.transports = new Map();
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.state.prepared).toHaveLength(1);
    expect(test.state.prepared[0][4]).toBe("prepare");
    expect(JSON.parse(String(test.state.prepared[0][5]))).toEqual({ zip: "19104", amountDue: 50 });
    expect(test.state.prepared[0][10]).toBe(artifactId);
    const prepared = await PDFDocument.load(test.state.uploaded);
    expect(prepared.getForm().getTextField("ZIP").getText()).toBe("19104");
    expect(prepared.getForm().getTextField("Amount").getText()).toBe("50");
    expect(test.state.finished).toEqual([]);
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_begin_operation"))).toBe(false);
    const actions = JSON.parse(String(test.state.saved[0][4]));
    expect(actions.some((action: { resolver?: string }) => !action.resolver || action.resolver === "parent")).toBe(false);
  });
  it.each(["program", "need", "expiry"])("does not prepare a form whose %s differs from the current contract", async (changed) => {
    const test = setup();
    await formFixture(test);
    test.state.capabilityEnabled = false;
    if (changed === "program") test.state.template!.program_id = "snap-pa";
    if (changed === "need") test.state.template!.needs = ["snap_new"];
    if (changed === "expiry") test.state.template!.verified_until = fixtureNow.toISOString();
    await runOneParentJob(test.options);
    expect(test.state.uploaded).toHaveLength(0);
    expect(test.state.prepared).toEqual([]);
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("ships no invented production transports and does no work when nothing is due", async () => {
    expect(PARENT_TRANSPORTS.size).toBe(0);
    const test = setup();
    test.state.noJob = true;
    expect(await runOneParentJob(test.options)).toEqual({ state: "idle" });
    expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("prepares and begins an exact per-need operation, records its receipt, event and next trigger", async () => {
    const test = setup();
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.state.prepared[0][9]).toBe("electricity");
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(test.execute.mock.calls[0][0].packetHash).toBe("a".repeat(64));
    expect(test.state.finished[0][3]).toBe("sent");
    expect(test.state.events[0]).toMatchObject({
      need: "electricity",
      receipt,
    });
    expect(test.state.saved[0][7]).toBe("scheduled_follow_up");
  });
  it("keeps unconfigured routes prepared with operator ownership and no delivery", async () => {
    const test = setup();
    test.options.transports = PARENT_TRANSPORTS;
    await runOneParentJob(test.options);
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.state.prepared).toHaveLength(0);
    expect(JSON.parse(String(test.state.saved[0][4]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resolver: "operator" }),
      ]),
    );
  });
  it("reserves AI budget before generation and never retries it without permission", async () => {
    const test = setup();
    test.state.budget = false;
    expect(await runOneParentJob(test.options)).toEqual({
      state: "failed",
      reason: "ai_budget_exhausted",
    });
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.state.saved).toHaveLength(0);
  });
  it("checks current authority before tools and does not dispatch after revocation", async () => {
    const test = setup();
    test.state.revoked = true;
    expect((await runOneParentJob(test.options)).state).toBe("failed");
    expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("turns missing model configuration into an operator issue rather than pretending AI ran", async () => {
    const test = setup();
    delete test.options.apiKey;
    expect(await runOneParentJob(test.options)).toEqual({
      state: "failed",
      reason: "configuration_unavailable",
    });
    expect(test.execute).not.toHaveBeenCalled();
  });
  it.each([false,true])("downloads only through an exact scoped broker object (S3: %s)", async s3 => {
    const test = setup();
    test.state.s3Download = s3;
    uploadFixture(test);
    await runOneParentJob(test.options);
    const saved = test.database.query.mock.calls.find(([sql]) =>
      sql.includes("parent_save_document_facts"),
    )![1]!;
    expect(saved[5]).toBe(1);
    expect(saved[6]).toBe("2026-10-20");
    expect(String(saved[4])).not.toContain("Private name");
    expect(test.execute.mock.calls[0][0]).toMatchObject({
      packet: { amountDue: 50, documentIds: [documentId] },
      documents: [{ id: documentId, mediaType: "application/pdf" }],
    });
    expect(
      Array.from(test.execute.mock.calls[0][0].documents![0].bytes),
    ).toEqual(Array.from(test.state.source));
    expect(
      test.fetcher.mock.calls.every(([, init]) => init?.redirect === "error"),
    ).toBe(true);
  });
  it("rejects a broker redirect to another origin before downloading raw content", async () => {
    const test = setup();
    uploadFixture(test);
    test.state.badDownloadOrigin = true;
    await runOneParentJob(test.options);
    expect(test.options.processDocument).not.toHaveBeenCalled();
    expect(
      test.fetcher.mock.calls.every(
        ([url]) => !String(url).includes("unexpected.example"),
      ),
    ).toBe(true);
  });
  it("rejects a same-project S3 grant for a different household object before downloading", async () => {
    const test = setup();uploadFixture(test);test.state.s3Download = true;test.state.badDownloadPath = true;
    await runOneParentJob(test.options);
    expect(test.options.processDocument).not.toHaveBeenCalled();
    expect(test.fetcher.mock.calls.every(([url]) => !String(url).includes("another-household.pdf"))).toBe(true);
  });
  it("does not blame the parent or reject the file when the parser deployment is unavailable", async () => {
    const test = setup();
    uploadFixture(test);
    test.options.processDocument = vi.fn(async () => {
      throw new DocumentProcessingError("configuration_unavailable");
    });
    await runOneParentJob(test.options);
    expect(
      test.database.query.mock.calls.some(([sql]) =>
        sql.includes("parent_reject_document"),
      ),
    ).toBe(false);
    expect(JSON.parse(String(test.state.saved[0][4]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resolver: "operator" }),
      ]),
    );
  });
  it("freezes a personal-step packet without beginning or sending it", async () => {
    const test = setup();
    test.state.requiredActs = ["identity"];
    await runOneParentJob(test.options);
    expect(test.state.prepared).toHaveLength(1);
    expect(test.execute).not.toHaveBeenCalled();
    expect(
      test.database.query.mock.calls.some(([sql]) =>
        sql.includes("parent_begin_operation"),
      ),
    ).toBe(false);
    expect(JSON.parse(String(test.state.saved[0][4]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "personal_step",
          resolver: "parent",
        }),
      ]),
    );
  });
  it.each(["facts", "artifact", "request version", "attachments"])("does not borrow completed personal acts after %s changes", async (change) => {
    const test = setup();
    test.state.requiredActs = ["identity"];
    await runOneParentJob(test.options);
    const original = test.state.prepared[0];
    test.state.operations = [
      {
        id: operationId,
        request_version: 1,
        need: "electricity",
        program_id: "peco-cap",
        action: "submit",
        state: "prepared",
        packet: JSON.parse(String(original[5])),
        idempotency_key: original[8],
        updated_at: fixtureNow.toISOString(),
        personalActsComplete: true,
      },
    ];
    if (change === "facts")
      test.state.operations[0].packet = {
        ...JSON.parse(String(original[5])), householdSize: 9,
      };
    if (change === "artifact") test.state.operations[0].artifact_id = artifactId;
    if (change === "request version") test.state.operations[0].request_version = 2;
    if (change === "attachments")
      test.state.operations[0].packet = {
        ...JSON.parse(String(original[5])), documentIds: [documentId],
      };
    await runOneParentJob(test.options);
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.database.query.mock.calls.some(
      ([sql]) => sql.includes("parent_begin_operation"),
    )).toBe(false);
    expect(test.state.prepared).toHaveLength(2);
    test.state.operations[0].packet = JSON.parse(String(original[5]));
    test.state.operations[0].request_version = 1;
    delete test.state.operations[0].artifact_id;
    await runOneParentJob(test.options);
    expect(test.execute).toHaveBeenCalledTimes(1);
  });
  it("rechecks authority after freezing a ready operation and before transport", async () => {
    const test = setup();
    const query = test.database.query.getMockImplementation()!;
    test.database.query.mockImplementation(async (sql, values) => {
      const result = await query(sql, values);
      if (sql.includes("parent_begin_operation")) test.state.revoked = true;
      return result;
    });
    await runOneParentJob(test.options);
    expect(test.state.revoked).toBe(true);
    expect(test.execute).not.toHaveBeenCalled();
    const calls = test.database.query.mock.calls.map(([sql]) => sql);
    const begin = calls.findIndex((sql) => sql.includes("parent_begin_operation"));
    expect(calls.slice(begin + 1).some(
      (sql) => sql.includes("parent_renew_job_lease"),
    )).toBe(true);
  });
  it("fills a verified template, stores its exact hash, confirms it, and sends those frozen bytes", async () => {
    const test = setup();
    await formFixture(test);
    await runOneParentJob(test.options);
    expect(test.state.uploaded.length).toBeGreaterThan(0);
    const pdf = await PDFDocument.load(test.state.uploaded);
    expect(pdf.getForm().getTextField("Amount").getText()).toBe("50");
    expect(pdf.getForm().getTextField("ZIP").getText()).toBe("19104");
    expect(test.state.prepared[0][10]).toBe(artifactId);
    expect(
      test.execute.mock.calls[0][0].artifact?.metadata.content_sha256,
    ).toBe(hash(test.state.uploaded));
    expect(
      test.database.query.mock.calls.some(([sql]) =>
        sql.includes("parent_confirm_form_artifact"),
      ),
    ).toBe(true);
  });
  it("asks for the exact missing form fact without generating a fictitious artifact", async () => {
    const test = setup();
    await formFixture(test);
    test.state.claim.request.facts = [];
    await runOneParentJob(test.options);
    expect(test.state.artifact).toBeNull();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.fetcher).not.toHaveBeenCalled();
    expect(JSON.parse(String(test.state.saved[0][4]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "amountDue", reason: "missing_fact" }),
      ]),
    );
  });
  it("records an unknown delivery on a transport timeout and never claims a receipt", async () => {
    const test = setup();
    test.execute.mockRejectedValue(new Error("synthetic timeout"));
    await runOneParentJob(test.options);
    expect(test.state.finished[0][3]).toBe("delivery_unknown");
    expect(
      test.state.events.some(
        (event) => (event as { receipt?: unknown }).receipt,
      ),
    ).toBe(false);
  });
  it.each(["2026-10-25T12:00:00Z", "2026-10-25T12:00:00+00:00", "2026-10-25T17:30:00+05:30"])("preserves audited operator attribution with %s and never promotes a parent report", (observedAt) => {
    const raw = {
      id: operationId,
      need: "electricity",
      request_version: 1,
      program_id: "peco-cap",
      action: "submit",
      state: "support_received",
      packet: { zip: "19104" },
      idempotency_key: "synthetic-key",
      updated_at: fixtureNow.toISOString(),
      evidence: {
        source: "operator_confirmed",
        reference: "audited-synthetic-receipt",
        observedAt,
      },
    };
    expect(normalizeWorkerOperation(raw)?.receipt?.source).toBe(
      "operator_confirmed",
    );
    expect(normalizeWorkerOperation(raw)?.receipt?.recordedAt).toBe(observedAt);
    expect(
      normalizeWorkerOperation({
        ...raw,
        evidence: { ...raw.evidence, source: "parent_reported" },
      }),
    ).toBeNull();
  });
});

describe("synthetic reference-only protected SNAP worker", () => {
  function protectedSetup() {
    const test = setup(), canonical = fixtureProtectedSnapOperation({ personalActsComplete: true, snapSubmissionAuthorized: true });
    test.state.claim.request.intake = fixtureIntake({ needs: ["snap_new"], zip: "19000" });
    test.state.claim.request.mandate = fixtureMandate({ recipientIds: ["snap-pa"] });
    test.state.allowedFields = ["protectedSnapPacket", "incomeAmount"];
    const raw = { id: canonical.operationId, request_id: canonical.requestId, request_version: canonical.requestVersion, need: canonical.need,
      program_id: canonical.programId, action: canonical.action, state: canonical.state, packet: canonical.packet, packet_hash: canonical.packetHash,
      data_categories: canonical.dataCategories, document_ids: [], artifact_id: null, idempotency_key: canonical.idempotencyKey,
      permission_version: canonical.permissionVersion, updated_at: fixtureNow.toISOString(), executed_at: null as string | null, personalActsComplete: true,
      snapSubmissionAuthorized: true, protectedPacketCurrent: true, protectedParentSubmitReady: true };
    test.state.operations = [raw];
    const result = { operationId, packetId: canonical.packet.protectedSnapPacket.packetId, contentSha256: canonical.packet.protectedSnapPacket.contentSha256, receipt };
    const port = { execute: vi.fn<SnapProtectedSubmissionPort["execute"]>(async () => result), reconcile: vi.fn<SnapProtectedSubmissionPort["reconcile"]>(async () => null) };
    test.options.protectedSnapSubmission = port;
    test.options.transports = new Map([["snap-pa:submit", { execute: test.execute }], ["snap-pa:follow_up", { execute: test.execute, reconcile: vi.fn(async () => receipt) }]]);
    return { ...test, canonical, raw, port, result };
  }
  it.each(["execute", "reconcile"] as const)("stops scheduled carrier checks after persisted terminal failure on %s without enabling a resend", async action => {
    const test = protectedSetup(); delete test.options.apiKey;
    const failed = { operationId, packetId: test.canonical.packet.protectedSnapPacket.packetId,
      contentSha256: test.canonical.packet.protectedSnapPacket.contentSha256, state: "delivery_unknown", transportStatus: "FAILURE" };
    test.port[action].mockResolvedValue(failed);
    if (action === "reconcile") Object.assign(test.raw, { state: "delivery_unknown", executed_at: fixtureNow.toISOString(), protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    await runOneParentJob(test.options);
    expect(test.state.saved[0].slice(5)).toEqual([null, "operator", "verified_receipt_available"]);
    expect(JSON.parse(String(test.state.saved[0][4]))).toContainEqual(expect.objectContaining({
      title: "Resolve the failed fax transmission", resolver: "operator", explanation: expect.stringContaining("Some pages may have arrived"),
    }));
    expect(test.port[action]).toHaveBeenCalledOnce();
    expect(test.port[action === "execute" ? "reconcile" : "execute"]).not.toHaveBeenCalled();
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_reconcile_operation") || sql.includes("parent_reserve_ai_call"))).toBe(false);
    expect(test.fetcher).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled();
    if (action === "execute") expect(test.state.finished[0][3]).toBe("delivery_unknown");
  });
  it.each(["missing model key", "model outage", "exhausted planning budget"])("continues an exact authorized protected Submit through %s without fresh planning", async unavailable => {
    const test = protectedSetup(), coordinate = vi.fn(test.options.coordinate!); test.options.coordinate = coordinate;
    if (unavailable === "missing model key") delete test.options.apiKey;
    if (unavailable === "model outage") coordinate.mockRejectedValue(new Error("MODEL_UNAVAILABLE"));
    if (unavailable === "exhausted planning budget") test.state.budget = false;
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.port.execute).toHaveBeenCalledOnce(); expect(coordinate).not.toHaveBeenCalled();
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_reserve_ai_call"))).toBe(false);
    expect(test.fetcher).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled();
  });
  it("automatically claims the scheduled second pass from QUEUED fax to COMPLETED through the actual private client and service", async () => {
    vi.useFakeTimers(); vi.setSystemTime(fixtureNow);
    const test = protectedSetup(), bytes = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf");
    const sourceHash = hash(bytes), ref = test.canonical.packet.protectedSnapPacket;
    Object.assign(ref, { contentSha256: sourceHash, byteLength: bytes.length });
    let clock = new Date(fixtureNow), due = clock.getTime(), completed = false;
    const until = new Date(clock.getTime() + 1800000).toISOString();
    const binding: SnapFinalPacketBinding = { format: "caselink-snap-final-packet-v1", packetId: ref.packetId, authorizationId: ref.authorizationId,
      snapshotId: ref.snapshotId, snapshotHash: ref.snapshotHash, contentSha256: sourceHash, byteLength: bytes.length, ownerId: test.state.claim.request.household_id,
      requestId: test.canonical.requestId, requestVersion: 1, recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet",
      policyVersion: "synthetic-policy", retentionPolicyVersion: "synthetic-retention", templateId: SNAP_DRAFT_CONTRACT.id,
      templateVersion: SNAP_DRAFT_CONTRACT.version, templateSha256: SNAP_DRAFT_CONTRACT.sha256, expiresAt: until };
    const key = Buffer.alloc(32, 7), sealed = sealSnapFinalPacket(bytes, key, binding, clock);
    const envelope = { binding, keyBase64: key.toString("base64"), aad: Buffer.from(snapFinalPacketAad(binding)).toString("base64"),
      iv: Buffer.from(sealed.iv).toString("base64"), tag: Buffer.from(sealed.tag).toString("base64"), ciphertext: Buffer.from(sealed.ciphertext).toString("base64") };
    const attempt: SnapSenderAttempt = { operationId, packetId: ref.packetId, contentSha256: sourceHash,
      operationRef: hash(Buffer.from(test.canonical.idempotencyKey)), attemptedAt: clock.toISOString(), dispatchAuthorizedAt: null, expiresAt: until,
      projectId: "synthetic-project", serviceId: "synthetic-service", from: "+12155550101", to: "+12155550102", destinationId: "synthetic-office", destinationVersion: "v1",
      pageCount: 12, providerId: null, providerStatus: "UNKNOWN" };
    const store: SnapSenderStore = {
      reserve: vi.fn<SnapSenderStore["reserve"]>(async () => ({ state: "dispatch_allowed", attempt: { ...attempt }, envelope })),
      resume: vi.fn(async () => { throw new Error("Must not resume dispatched work"); }),
      read: vi.fn(async () => ({ ...attempt })),
      recheck: vi.fn(async () => { if (attempt.dispatchAuthorizedAt) throw new Error("Already dispatched"); attempt.dispatchAuthorizedAt = clock.toISOString(); return { ...attempt }; }),
      record: vi.fn(async (_, providerId, providerStatus) => { Object.assign(attempt, { providerId, providerStatus }); return { ...attempt }; }),
    };
    const carrier: SnapSenderCarrier = {
      validateAttempt: input => snapSenderAttemptSchema.parse(input), checkConfiguration: vi.fn(async () => {}),
      send: vi.fn<SnapSenderCarrier["send"]>(async (_, exactBytes, beforeSend) => { await beforeSend(); expect(hash(exactBytes)).toBe(sourceHash); return { providerId: "synthetic-fax", providerStatus: "QUEUED" }; }),
      reconcile: vi.fn<SnapSenderCarrier["reconcile"]>(async () => completed ? { providerId: "synthetic-fax", providerStatus: "COMPLETED", completedAt: clock.toISOString() }
        : { providerId: "synthetic-fax", providerStatus: "QUEUED" }),
    };
    const inspection = vi.spyOn(finalPdfInspection, "inspectSnapFinalPdf").mockResolvedValue({ ok: true, scope: "structure_only", contentSha256: sourceHash,
      byteLength: bytes.length, source: { templateId: SNAP_DRAFT_CONTRACT.id, templateVersion: SNAP_DRAFT_CONTRACT.version, templateSha256: SNAP_DRAFT_CONTRACT.sha256 },
      pageCount: 12, pageWidth: 612, pageHeight: 792, rotation: 0, userUnit: 1, staticContentChecked: true });
    const origin = "http://127.0.0.1:3340", secret = "synthetic-private-sender-secret-with-32-characters";
    const handler = createSnapProtectedSenderHandler({ origin, secret, delivery: createSnapProtectedDelivery({ store, carrier }) });
    const privateFetch = vi.fn<typeof fetch>(async (url, init) => handler(new Request(String(url), { ...init,
      headers: { ...init!.headers, Host: "127.0.0.1:3340", "Content-Length": String(Buffer.byteLength(String(init!.body))) } })));
    test.options.protectedSnapSubmission = createSnapProtectedSubmissionClient({ origin, secret, fetcher: privateFetch });
    test.options.transports = new Map();
    const coordinate = vi.fn(test.options.coordinate!); test.options.coordinate = coordinate; delete test.options.apiKey;
    test.options.now = () => clock; test.state.deliveryJobAttempts = 0;
    const query = test.database.query.getMockImplementation()!;
    test.database.query.mockImplementation(async (sql, values = []) => {
      if (sql.includes("parent_claim_job")) {
        if (clock.getTime() < due) return { rows: [{ job: null }] };
        test.state.deliveryJobAttempts = (test.state.deliveryJobAttempts ?? 0) + 1;
      }
      if (sql.includes("parent_finish_operation")) Object.assign(test.raw, { state: values[3], executed_at: fixtureNow.toISOString() });
      if (sql.includes("parent_save_job_plan")) due = values[5] ? Date.parse(String(values[5])) : Infinity;
      return query(sql, values);
    });
    try {
      expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
      const saved = test.state.saved[0];
      expect(saved.slice(5)).toEqual([new Date(fixtureNow.getTime() + 300000).toISOString(), "caselink", "scheduled_follow_up"]);
      expect(test.state.finished[0][3]).toBe("delivery_unknown"); expect(attempt.providerStatus).toBe("QUEUED");
      const queryOrder = test.database.query.mock.calls.map(([sql]) => sql);
      expect(queryOrder.findIndex(sql => sql.includes("parent_get_snap_delivery_job_attempts"))).toBeLessThan(queryOrder.findIndex(sql => sql.includes("parent_begin_operation")));
      expect(await runOneParentJob(test.options)).toEqual({ state: "idle" });
      completed = true; clock = new Date(String(saved[5])); vi.setSystemTime(clock);
      test.state.leaseExpiresAt = new Date(clock.getTime() + 300000).toISOString(); test.state.claim.leaseToken = documentId;
      expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
      expect(privateFetch.mock.calls.map(call => new URL(String(call[0])).pathname)).toEqual(["/snap/execute", "/snap/reconcile"]);
      expect(carrier.send).toHaveBeenCalledOnce(); expect(carrier.reconcile).toHaveBeenCalledTimes(2); expect(store.resume).not.toHaveBeenCalled();
      expect(test.database.query.mock.calls.filter(([sql]) => sql.includes("parent_get_snap_delivery_job_attempts"))).toHaveLength(2);
      const recorded = test.database.query.mock.calls.find(([sql]) => sql.includes("parent_reconcile_operation"));
      expect(JSON.parse(String(recorded?.[1]?.[4]))).toMatchObject({ state: "sent", source: "provider_api", reference: "sinch-fax:synthetic-fax" });
      expect(JSON.parse(String(test.state.saved[1][3])).routes[0].state).toBe("sent");
      expect(test.state.saved[1].slice(5)).toEqual([null, "operator", "provider_capability_enabled"]);
      expect(JSON.parse(String(test.state.saved[1][4]))).toContainEqual(expect.objectContaining({ title: "Connect verified status updates", resolver: "operator" }));
      expect(coordinate).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled();
      expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_reserve_ai_call"))).toBe(false);
      expect(JSON.stringify(privateFetch.mock.calls)).not.toMatch(/keyBase64|ciphertext|Pennsylvania Application/);
    } finally { inspection.mockRestore(); vi.useRealTimers(); }
  });
  it("schedules another bounded unknown-status pass against the same attempt without a model or submit", async () => {
    const test = protectedSetup(); delete test.options.apiKey;
    Object.assign(test.raw, { state: "delivery_unknown", executed_at: fixtureNow.toISOString(), protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    test.port.reconcile.mockResolvedValue({ operationId, packetId: test.canonical.packet.protectedSnapPacket.packetId,
      contentSha256: test.canonical.packet.protectedSnapPacket.contentSha256, state: "delivery_unknown" });
    await runOneParentJob(test.options);
    expect(test.state.saved[0].slice(5)).toEqual([new Date(fixtureNow.getTime() + 300000).toISOString(), "caselink", "scheduled_follow_up"]);
    const next = new Date(String(test.state.saved[0][5])); test.options.now = () => next;
    test.state.leaseExpiresAt = new Date(next.getTime() + 300000).toISOString(); test.state.deliveryJobAttempts = 2;
    await runOneParentJob(test.options);
    expect(test.state.saved[1].slice(5)).toEqual([new Date(next.getTime() + 300000).toISOString(), "caselink", "scheduled_follow_up"]);
    expect(test.port.reconcile).toHaveBeenCalledTimes(2); expect(test.port.execute).not.toHaveBeenCalled();
    expect(test.port.reconcile.mock.calls[0][0]).toMatchObject({ operationId, idempotencyKey: test.canonical.idempotencyKey });
    expect(test.port.reconcile.mock.calls[1][0]).toMatchObject({ operationId, idempotencyKey: test.canonical.idempotencyKey });
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_reserve_ai_call") || sql.includes("parent_begin_operation"))).toBe(false);
    expect(test.state.prepared).toEqual([]); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it.each([false, true])("after immediate carrier completion schedules agency follow-up only when an ordinary status transport is registered: %s", async registered => {
    const test = protectedSetup(), coordinate = vi.fn(test.options.coordinate!); test.options.coordinate = coordinate; delete test.options.apiKey;
    if (!registered) test.options.transports = new Map();
    await runOneParentJob(test.options);
    expect(JSON.parse(String(test.state.saved[0][3])).routes[0].state).toBe("sent");
    if (registered) expect(test.state.saved[0][5]).toBe(new Date(fixtureNow.getTime() + 3600000).toISOString());
    else {
      expect(test.state.saved[0].slice(5)).toEqual([null, "operator", "provider_capability_enabled"]);
      expect(JSON.parse(String(test.state.saved[0][4]))).toContainEqual(expect.objectContaining({ title: "Connect verified status updates" }));
    }
    expect(coordinate).not.toHaveBeenCalled(); expect(test.port.execute).toHaveBeenCalledOnce(); expect(test.execute).not.toHaveBeenCalled();
    expect(test.port.reconcile).not.toHaveBeenCalled();
  });
  it.each(["last_job_attempt", "unknown_attempt_count", "missing_port", "follow_up_disabled", "short_authority", "expired_authority", "short_capability", "disabled_capability", "expired_attempt_window", "nearly_expired_attempt_window", "invalid_attempt_time", "cancelled", "paused"])(
    "does not promise automatic fax recovery for %s", async reason => {
      const test = protectedSetup(); delete test.options.apiKey;
      Object.assign(test.raw, { state: "delivery_unknown", executed_at: fixtureNow.toISOString(), protectedPacketCurrent: false, snapSubmissionAuthorized: false });
      if (reason === "last_job_attempt") test.state.deliveryJobAttempts = 48;
      if (reason === "unknown_attempt_count") test.state.deliveryJobAttempts = null;
      if (reason === "missing_port") delete test.options.protectedSnapSubmission;
      if (reason === "follow_up_disabled") test.state.claim.request.mandate.allowedActions = ["research", "prepare", "submit"];
      if (reason === "short_authority") test.state.claim.request.mandate.expiresAt = new Date(fixtureNow.getTime() + 299000).toISOString();
      if (reason === "expired_authority") test.state.claim.request.mandate.expiresAt = fixtureNow.toISOString();
      if (reason === "short_capability" || reason === "disabled_capability") {
        const query = test.database.query.getMockImplementation()!;
        test.database.query.mockImplementation(async (sql, values = []) => {
          if (sql.includes("parent_get_capability") && values[1] === "follow_up") return { rows: [{ value: {
            programId: "snap-pa", enabled: reason !== "disabled_capability", actions: ["follow_up"], permissionReference: "synthetic-authority",
            permissionVersion: "synthetic-permission", permissionExpiresAt: new Date(fixtureNow.getTime() + 299000).toISOString(),
            dataCategories: ["household"], personalActsComplete: true,
          } }] };
          return query(sql, values);
        });
      }
      if (reason === "expired_attempt_window") test.raw.executed_at = new Date(fixtureNow.getTime() - 7200000).toISOString();
      if (reason === "nearly_expired_attempt_window") test.raw.executed_at = new Date(fixtureNow.getTime() - 7140000).toISOString();
      if (reason === "invalid_attempt_time") test.raw.executed_at = "invalid";
      if (reason === "cancelled" || reason === "paused") test.state.claim.request.status = reason;
      await runOneParentJob(test.options);
      expect(test.state.saved.at(-1)?.[5]).toBeNull();
      expect(test.state.saved.at(-1)?.[6]).not.toBe("caselink"); expect(test.port.execute).not.toHaveBeenCalled();
      if (reason === "missing_port") expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_get_snap_delivery_job_attempts"))).toBe(false);
      if (reason === "last_job_attempt") {
        expect(test.state.saved.at(-1)?.[6]).toBe("operator");
        expect(test.state.saved.at(-1)?.[7]).toBe("verified_receipt_available");
      }
    });
  it("allows attempt 47 to schedule the last claim, then stops at48 without moving the recorded deadline", async () => {
    const test = protectedSetup(); delete test.options.apiKey;
    Object.assign(test.raw, { state: "delivery_unknown", executed_at: fixtureNow.toISOString(), protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    test.state.deliveryJobAttempts = 47;
    await runOneParentJob(test.options); expect(test.state.saved[0][5]).toBe(new Date(fixtureNow.getTime() + 300000).toISOString());
    const next = new Date(String(test.state.saved[0][5])); test.options.now = () => next;
    test.state.leaseExpiresAt = new Date(next.getTime() + 300000).toISOString(); test.state.deliveryJobAttempts = 48;
    await runOneParentJob(test.options);
    expect(test.state.saved[1].slice(5)).toEqual([null, "operator", "verified_receipt_available"]);
    expect(test.raw.executed_at).toBe(fixtureNow.toISOString()); expect(test.port.execute).not.toHaveBeenCalled();
  });
  it("does not let an independent planning retry promise an unclaimable49th protected job", async () => {
    const test = protectedSetup(); delete test.options.apiKey; test.state.deliveryJobAttempts = 48;
    test.state.claim.request.intake.needs = ["snap_new", "electricity"];
    test.state.claim.request.mandate.recipientIds = ["snap-pa", "peco-cap"];
    Object.assign(test.raw, { state: "delivery_unknown", executed_at: fixtureNow.toISOString(), protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    await runOneParentJob(test.options);
    expect(test.state.saved[0].slice(5)).toEqual([null, "operator", "route_review_required"]);
    expect(test.port.execute).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled();
  });
  it("reconciles an existing protected unknown delivery without a model, storage read or repeated send", async () => {
    const test = protectedSetup(), coordinate = vi.fn(test.options.coordinate!); test.options.coordinate = coordinate; delete test.options.apiKey;
    Object.assign(test.raw, { state: "delivery_unknown", protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    const observed = { ...receipt, state: "agency_submitted", source: "agency_receipt", agencyStatus: {
      reference: "Synthetic agency notice", observedAt: fixtureNow.toISOString(), documents: [{ name: "Proof of earnings", dueDate: "2026-11-01" }],
      interview: { channel: "phone", scheduledAt: "2026-10-28T10:00:00-04:00" },
    } };
    test.port.reconcile.mockResolvedValue({ ...test.result, receipt: observed });
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.port.reconcile).toHaveBeenCalledOnce(); expect(test.port.execute).not.toHaveBeenCalled();
    expect(coordinate).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_reserve_ai_call"))).toBe(false);
    const recorded = test.database.query.mock.calls.find(([sql]) => sql.includes("parent_reconcile_operation"));
    expect(JSON.parse(String(recorded?.[1]?.[4]))).toEqual(observed);
    expect(normalizeWorkerOperation({ ...test.raw, state: observed.state, evidence: observed })?.receipt).toEqual(observed);
  });
  it("preserves unrelated routes and questions without planning or executing their work during protected continuation", async () => {
    const test = protectedSetup(); delete test.options.apiKey;
    test.state.claim.request.intake.needs = ["snap_new", "electricity"];
    test.state.claim.request.mandate.recipientIds = ["snap-pa", "peco-cap"];
    const plan = buildSupportPlan(test.state.claim.request, fixtureNow), other = plan.routes.find(route => route.need === "electricity")!;
    test.state.claim.request.plan = plan;
    const question = { id: "saved-utility-question", need: "electricity" as const, reason: "missing_fact" as const, title: "Saved question", explanation: "Keep the current utility draft.", field: "income", resolved: false };
    test.state.claim.request.required_actions = [question];
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(JSON.parse(String(test.state.saved[0][3])).routes.find((route: { need: string }) => route.need === "electricity")).toEqual(other);
    expect(JSON.parse(String(test.state.saved[0][4]))).toContainEqual(question);
    expect(test.state.saved[0][5]).toBe(new Date(fixtureNow.getTime()+300000).toISOString());
    expect(test.execute).not.toHaveBeenCalled(); expect(test.port.execute).toHaveBeenCalledOnce(); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("keeps an unconfirmed SNAP attempt read-only while scheduling the independent driver", async () => {
    const test = protectedSetup(); delete test.options.apiKey;
    test.options.continuationOnly = true;
    test.state.claim.request.intake.needs = ["snap_new", "electricity"];
    test.state.claim.request.mandate.recipientIds = ["snap-pa", "peco-cap"];
    Object.assign(test.raw, { state: "delivery_unknown", protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.state.saved[0][5]).toBe(new Date(fixtureNow.getTime()+300000).toISOString());
    expect(test.state.saved[0][7]).toBe("scheduled_follow_up");
    expect(test.state.prepared).toEqual([]); expect(test.port.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("uses the continuation-only database claim before reading any job", async () => {
    const test = protectedSetup(); test.options.continuationOnly = true; delete test.options.apiKey;
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.database.query).toHaveBeenNthCalledWith(1, "select parent_private.parent_claim_job($1,$2) as job", [300, true]);
  });
  it("stays idle without touching queued work when the continuation claim finds no eligible operation", async () => {
    const test = protectedSetup(); test.options.continuationOnly = true; delete test.options.apiKey;
    test.database.query.mockResolvedValueOnce({ rows: [{ job: null }] });
    expect(await runOneParentJob(test.options)).toEqual({ state: "idle" });
    expect(test.database.query).toHaveBeenCalledExactlyOnceWith("select parent_private.parent_claim_job($1,$2) as job", [300, true]);
    expect(test.port.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("defers a newly due follow-up after reconciling an aged protected receipt", async () => {
    const test = protectedSetup(); delete test.options.apiKey;
    Object.assign(test.raw, { state: "delivery_unknown", protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    test.port.reconcile.mockResolvedValue({ ...test.result, receipt: { ...receipt, recordedAt: new Date(fixtureNow.getTime()-172800000).toISOString() } });
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.port.reconcile).toHaveBeenCalledOnce(); expect(test.port.execute).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled(); expect(test.state.prepared).toEqual([]); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("does not reconcile an ordinary unknown operation alongside the protected continuation", async () => {
    const test = protectedSetup(); delete test.options.apiKey;
    Object.assign(test.raw, { state: "delivery_unknown", protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    test.state.operations.push({ ...test.raw, id: documentId, packet: { zip: "19104" }, idempotency_key: "ordinary-unknown" });
    const reconcile = vi.fn(async () => receipt); test.options.transports = new Map([["snap-pa:follow_up", { execute: test.execute, reconcile }]]);
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.port.reconcile).toHaveBeenCalledOnce(); expect(reconcile).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled();
    expect(test.state.prepared).toEqual([]); expect(test.fetcher).not.toHaveBeenCalled();
  });
  function mixedSetup() {
    const test = protectedSetup(); test.state.claim.request.intake = fixtureIntake({ needs: ["snap_new", "electricity"] });
    test.state.claim.request.mandate.recipientIds = ["snap-pa", "peco-cap"];
    test.state.allowedFields = ["protectedSnapPacket", "zip", "utilityProvider", "accountAuthority"];
    test.options.transports = new Map([["peco-cap:submit", { execute: test.execute }]]);
    test.state.claim.request.plan = buildSupportPlan(test.state.claim.request, fixtureNow);
    return test;
  }
  it("resumes independent work when the driver returns without repeating SNAP submission", async () => {
    const test = mixedSetup(), apiKey = test.options.apiKey;
    Object.assign(test.raw, { state: "delivery_unknown", protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    test.options.continuationOnly = true; delete test.options.apiKey;
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.state.saved[0][5]).toBe(new Date(fixtureNow.getTime()+300000).toISOString());
    expect(test.execute).not.toHaveBeenCalled();
    test.options.continuationOnly = false; test.options.apiKey = apiKey;
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.execute).toHaveBeenCalledOnce(); expect(test.port.execute).not.toHaveBeenCalled();
    expect(test.port.reconcile).toHaveBeenCalledTimes(2);
  });
  it("pursues independent utility work with a healthy driver while SNAP delivery remains unknown", async () => {
    const test = mixedSetup(), coordinate = vi.fn(test.options.coordinate!); test.options.coordinate = coordinate;
    Object.assign(test.raw, { state: "delivery_unknown", protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.port.reconcile).toHaveBeenCalledOnce(); expect(test.port.execute).not.toHaveBeenCalled();
    expect(coordinate).toHaveBeenCalledOnce(); expect(coordinate.mock.calls[0][0].request.intake.needs).toEqual(["electricity"]);
    expect(test.execute).toHaveBeenCalledOnce(); expect(test.state.prepared).toHaveLength(1);
    expect(test.state.prepared[0][3]).toBe("peco-cap"); expect(test.state.prepared[0][9]).toBe("electricity");
    const routes = JSON.parse(String(test.state.saved[0][3])).routes;
    expect(routes.find((route: { need: string }) => route.need === "electricity").state).toBe("sent");
    expect(test.fetcher).not.toHaveBeenCalled();
  });
  it.each(["model outage", "exhausted planning budget"])("saves the exact SNAP result and other saved work through a mixed-needs %s", async unavailable => {
    const test = mixedSetup(), previous = test.state.claim.request.plan!.routes.find(route => route.need === "electricity");
    if (unavailable === "model outage") test.options.coordinate = vi.fn(async () => { throw new Error("MODEL_UNAVAILABLE"); });
    else test.state.budget = false;
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.port.execute).toHaveBeenCalledOnce(); expect(test.execute).not.toHaveBeenCalled();
    const routes = JSON.parse(String(test.state.saved[0][3])).routes;
    expect(routes.find((route: { need: string }) => route.need === "snap_new").state).toBe("sent");
    expect(routes.find((route: { need: string }) => route.need === "electricity")).toEqual(previous);
    expect(test.state.saved[0][5]).toBe(new Date(fixtureNow.getTime()+300000).toISOString());
    expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("keeps a genuine reconciled SNAP receipt when the independent driver fails", async () => {
    const test = mixedSetup(); Object.assign(test.raw, { state: "delivery_unknown", protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    test.port.reconcile.mockResolvedValue({ ...test.result, receipt: { ...receipt, state: "agency_submitted", source: "agency_receipt" } });
    test.options.coordinate = vi.fn(async () => { throw new Error("MODEL_UNAVAILABLE"); });
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(JSON.parse(String(test.state.saved[0][3])).routes.find((route: { need: string }) => route.need === "snap_new").state).toBe("agency_submitted");
    expect(test.port.execute).not.toHaveBeenCalled(); expect(test.port.reconcile).toHaveBeenCalledOnce(); expect(test.execute).not.toHaveBeenCalled();
  });
  it("passes only the exact lease and immutable reference, with no Storage or ordinary transport", async () => {
    const test = protectedSetup(); expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.port.execute).toHaveBeenCalledExactlyOnceWith({ jobId, leaseToken, operationId, requestId: test.canonical.requestId,
      requestVersion: 1, packetHash: test.canonical.packetHash, idempotencyKey: test.canonical.idempotencyKey,
      protectedPacket: test.canonical.packet.protectedSnapPacket, signal: expect.any(AbortSignal) });
    expect(test.fetcher).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled(); expect(test.state.prepared).toEqual([]);
    expect(test.state.finished[0][3]).toBe("sent"); expect(JSON.parse(String(test.state.finished[0][4]))).toEqual(receipt);
  });
  it("cannot fall back to an ordinary program transport when the private port is absent", async () => {
    const test = protectedSetup(); delete test.options.protectedSnapSubmission; test.raw.snapSubmissionAuthorized = false; test.raw.personalActsComplete = false; await runOneParentJob(test.options);
    expect(test.port.execute).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_begin_operation"))).toBe(false);
    expect(PARENT_TRANSPORTS.size).toBe(0);
    expect(JSON.parse(String(test.state.saved.at(-1)![4]))).not.toContainEqual(expect.objectContaining({ reason: "submission_review" }));
  });
  it.each(["snapSubmissionAuthorized", "personalActsComplete", "protectedPacketCurrent", "protectedParentSubmitReady"] as const)("does not execute without the exact %s flag", async field => {
    const test = protectedSetup(); test.raw[field] = false; await runOneParentJob(test.options);
    expect(test.port.execute).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_begin_operation"))).toBe(false);
  });
  it.each(["protectedPacketCurrent", "protectedParentSubmitReady"].flatMap(field => ["true", 1, null, {}, []].map(flag => ({ field, flag }))))("rejects malformed $field = $flag", async ({ field, flag }) => {
    const test = protectedSetup(); Object.assign(test.raw, { [field]: flag });
    await expect(runOneParentJob(test.options)).rejects.toThrow(); expect(test.port.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it.each(["protectedPacketCurrent", "protectedParentSubmitReady"] as const)("fails closed when %s is absent", async field => {
    const test = protectedSetup(); delete (test.raw as Partial<typeof test.raw>)[field]; await runOneParentJob(test.options);
    expect(test.port.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_begin_operation"))).toBe(false);
  });
  it.each(["packetHash", "permissionVersion", "protectedPacket", "artifact", "unexpectedPrivateField"])("rejects a changed frozen %s before the private sender", async field => {
    const test = protectedSetup(); test.state.protectedFrozenChange[field] = field === "packetHash" ? "e".repeat(64) : field === "permissionVersion" ? "changed"
      : field === "artifact" ? { id: artifactId, object_path: "not-a-protected-storage-path", content_sha256: "e".repeat(64) }
        : { ...test.canonical.packet.protectedSnapPacket, contentSha256: "e".repeat(64) };
    await runOneParentJob(test.options); expect(test.port.execute).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("keeps mismatched or promoted results unknown and reconciles read-only without resending", async () => {
    const test = protectedSetup(); test.port.execute.mockResolvedValue({ ...test.result, receipt: { ...receipt, state: "agency_submitted" } });
    await runOneParentJob(test.options); expect(test.state.finished[0][3]).toBe("delivery_unknown");
    Object.assign(test.raw, { state: "delivery_unknown", protectedPacketCurrent: false, snapSubmissionAuthorized: false });
    await runOneParentJob(test.options); expect(test.port.execute).toHaveBeenCalledOnce(); expect(test.port.reconcile).toHaveBeenCalledOnce();
    expect(test.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("requires exact metadata on the private result, without interpreting an unmatched receipt", async () => {
    const test = protectedSetup(); test.port.execute.mockResolvedValue({ ...test.result, packetId: documentId });
    await runOneParentJob(test.options); expect(test.state.finished[0][3]).toBe("delivery_unknown"); expect(test.port.execute).toHaveBeenCalledOnce();
  });
  it("advances only a separately attributed genuine-agency result", async () => {
    const test = protectedSetup(); test.port.execute.mockResolvedValue({ ...test.result, receipt: { ...receipt, state: "agency_submitted", source: "agency_receipt" } });
    await runOneParentJob(test.options); expect(test.state.finished[0][3]).toBe("agency_submitted"); expect(test.fetcher).not.toHaveBeenCalled(); expect(test.execute).not.toHaveBeenCalled();
  });
  describe("durable pending capture orchestration", () => {
    function pendingSetup() {
      const test = protectedSetup(), intent = fixtureSnapCaptureIntent();
      test.raw.personalActsComplete = false; test.raw.snapSubmissionAuthorized = false; test.state.operations = [];
      const pending = { packetId: intent.packetId, requestId: intent.requestId, requestVersion: intent.requestVersion, state: "pending", reason: null,
        intent, deadline: new Date(fixtureNow.getTime()+120000).toISOString() };
      test.state.pendingCapture = pending;
      const checker = { prepareCapture: vi.fn<SnapCapturePreparationPort["prepareCapture"]>(async (): Promise<unknown> => {
        test.state.pendingCapture = { ...pending, state: "checked" }; test.state.operations = [test.raw];
        return { packetId: intent.packetId, requestId: intent.requestId, requestVersion: intent.requestVersion, contentSha256: intent.contentSha256,
          state: "checked", reason: null, operationId };
      }) };
      test.options.snapCapturePreparation = checker;
      return { ...test, pending, checker, intent };
    }
    it("automatically saves exact review after direct completion through the real coordinator without dispatch or protected model input", async () => {
      const test = pendingSetup();
      test.state.claim.request.intake.zip = "19104";
      test.state.pendingCapture = { ...test.pending, state: "checked" };
      test.state.operations = [test.raw];
      delete test.options.coordinate;
      const model = vi.fn<typeof fetch>(async (url, init): Promise<Response> => {
        expect(url).toBe("https://api.openai.com/v1/responses");
        expect(test.database.query.mock.calls.filter(([sql]) => sql.includes("parent_reserve_ai_call"))).toHaveLength(model.mock.calls.length);
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ model: "gpt-6.1-sol", store: false, max_output_tokens: 3000 });
        expect(JSON.parse(body.input[0].content)).toMatchObject({ needs: ["snap_new"], authorizedRecipients: ["snap-pa"] });
        expect(String(init?.body)).not.toMatch(/protectedSnapPacket|snapshotHash|contentSha256|authorizationId|verificationId|strokes|ssn/i);
        for (const id of [test.intent.packetId, test.intent.authorizationId, test.intent.snapshotId, test.intent.requestId])
          expect(String(init?.body)).not.toContain(id);
        return Response.json({ status: "completed", output: model.mock.calls.length === 1 ? [{ type: "function_call", name: "select_programs",
          call_id: "synthetic-first-review", arguments: JSON.stringify({ selections: [{ need: "snap_new", programId: "snap-pa" }] }) }] : [],
          usage: { input_tokens: 10, output_tokens: 10 } });
      });
      test.options.fetcher = model;
      expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
      expect(model).toHaveBeenCalledTimes(2);
      expect(test.checker.prepareCapture).not.toHaveBeenCalled();
      expect(test.port.execute).not.toHaveBeenCalled(); expect(test.port.reconcile).not.toHaveBeenCalled();
      expect(test.execute).not.toHaveBeenCalled(); expect(test.state.prepared).toEqual([]);
      expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_begin_operation"))).toBe(false);
      expect(JSON.parse(String(test.state.saved.at(-1)![4]))).toContainEqual(expect.objectContaining({
        reason: "submission_review", field: "snap_final_submit", resolver: "parent",
      }));
      expect(test.raw.snapSubmissionAuthorized).toBe(false); expect(test.raw.personalActsComplete).toBe(false);
    });
    it("checks the durable exact pointer under the lease, then reloads real canonical metadata for review", async () => {
      const test = pendingSetup(); await runOneParentJob(test.options);
      expect(test.checker.prepareCapture).toHaveBeenCalledExactlyOnceWith({ jobId, leaseToken, requestId: test.intent.requestId, requestVersion: 1,
        packetId: test.intent.packetId, intent: test.intent, deadline: new Date(fixtureNow.getTime()+90000).toISOString(), signal: expect.any(AbortSignal) });
      const calls = test.database.query.mock.calls.map(([sql]) => sql);
      expect(calls.findIndex(sql => sql.includes("parent_get_snap_pending_capture"))).toBeLessThan(calls.findIndex(sql => sql.includes("parent_get_operations")));
      expect(calls.filter(sql => sql.includes("parent_get_operations"))).toHaveLength(2);
      expect(JSON.parse(String(test.state.saved.at(-1)![4]))).toContainEqual(expect.objectContaining({ reason: "submission_review", field: "snap_final_submit" }));
      expect(test.port.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
    });
    it("recovers a lost checker response read-only when durable checked metadata and canonical evidence exist", async () => {
      const test = pendingSetup(), original = test.checker.prepareCapture.getMockImplementation()!;
      test.checker.prepareCapture.mockImplementation(async input => { await original(input); throw new Error("PRIVATE_CHECKER_CANARY"); });
      await runOneParentJob(test.options); expect(test.checker.prepareCapture).toHaveBeenCalledOnce();
      expect(JSON.parse(String(test.state.saved.at(-1)![4]))).toContainEqual(expect.objectContaining({ reason: "submission_review" }));
      expect(JSON.stringify(test.state.saved)).not.toContain("PRIVATE_CHECKER_CANARY");
    });
    it("does not accept a checked response without durable canonical evidence", async () => {
      const test = pendingSetup(); test.checker.prepareCapture.mockResolvedValue({ packetId: test.intent.packetId, requestId: test.intent.requestId,
        requestVersion: 1, contentSha256: test.intent.contentSha256, state: "checked", reason: null, operationId });
      await runOneParentJob(test.options);
      const actions = JSON.parse(String(test.state.saved.at(-1)![4])); expect(actions).toContainEqual(expect.objectContaining({ reason: "execution_issue" }));
      expect(actions.some((action: { reason: string }) => action.reason === "submission_review")).toBe(false);
      expect(test.port.execute).not.toHaveBeenCalled(); expect(test.checker.prepareCapture).toHaveBeenCalledOnce();
      expect(test.state.saved.at(-1)![5]).toBe(new Date(fixtureNow.getTime()+119000).toISOString());
      expect(test.state.saved.at(-1)![6]).toBe("caselink");
    });
    it("keeps a missing checker with CaseLink and does not spin or fall back to Storage", async () => {
      const test = pendingSetup(); delete test.options.snapCapturePreparation; await runOneParentJob(test.options);
      expect(test.checker.prepareCapture).not.toHaveBeenCalled(); expect(test.port.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
      expect(test.state.saved.at(-1)![5]).toBeNull(); expect(test.state.prepared).toEqual([]);
      expect(JSON.parse(String(test.state.saved.at(-1)![4]))).toEqual([expect.objectContaining({ reason: "execution_issue", resolver: "operator" })]);
    });
    it("schedules a bounded read-only retry after a metadata read fails under a renewed lease", async () => {
      const test = pendingSetup(); test.state.pendingReadFailure = true; await runOneParentJob(test.options);
      expect(test.checker.prepareCapture).not.toHaveBeenCalled(); expect(test.port.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
      expect(test.state.saved.at(-1)![5]).toBe(new Date(fixtureNow.getTime()+299000).toISOString()); expect(test.state.saved.at(-1)![6]).toBe("caselink");
      expect(JSON.stringify(test.state.saved)).not.toContain("PRIVATE_METADATA_CANARY");
    });
    it("bounds an ignored private signal by the earlier file deadline and recovers read-only", async () => {
      const test = pendingSetup(); test.state.pendingCapture = { ...test.pending, deadline: new Date(fixtureNow.getTime()+5).toISOString() };
      test.checker.prepareCapture.mockImplementation(async () => new Promise(() => {}));
      await runOneParentJob(test.options); expect(test.checker.prepareCapture).toHaveBeenCalledOnce();
      expect(test.checker.prepareCapture.mock.calls[0][0].signal.aborted).toBe(true);
      expect(test.port.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled(); expect(test.state.saved.at(-1)![5]).toBeNull();
    });
    it.each(["wrong_request", "wrong_version", "wrong_packet", "expired", "beyond_lease"])("rejects %s metadata before the private port", async kind => {
      const test = pendingSetup();
      if (kind === "wrong_request") test.state.pendingCapture = { ...test.pending, requestId: documentId };
      if (kind === "wrong_version") test.state.pendingCapture = { ...test.pending, requestVersion: 2 };
      if (kind === "wrong_packet") test.state.pendingCapture = { ...test.pending, packetId: documentId };
      if (kind === "expired") test.state.pendingCapture = { ...test.pending, deadline: fixtureNow.toISOString() };
      if (kind === "beyond_lease") test.state.pendingCapture = { ...test.pending, deadline: new Date(fixtureNow.getTime()+301000).toISOString() };
      await runOneParentJob(test.options); expect(test.checker.prepareCapture).not.toHaveBeenCalled(); expect(test.port.execute).not.toHaveBeenCalled();
    });
    it.each(["page_1_unreadable", "page_5_unreadable", "applicant_identifier_needed", "personal_mark_or_date_needed", "facts_correction_needed"])("shows the one protected necessary step for durable %s", async reason => {
      const test = pendingSetup(); test.state.pendingCapture = { ...test.pending, state: "needs_parent", reason }; await runOneParentJob(test.options);
      expect(test.checker.prepareCapture).not.toHaveBeenCalled();
      const actions = JSON.parse(String(test.state.saved.at(-1)![4])); expect(actions).toEqual([expect.objectContaining({ reason: "personal_step", field: "snap_personal_pages", resolver: "parent" })]);
      expect(actions[0].url).toBeUndefined(); expect(test.port.execute).not.toHaveBeenCalled();
    });
    it("continues an independent utility need while the private checker is unavailable", async () => {
      const test = pendingSetup(); delete test.options.snapCapturePreparation;
      test.state.claim.request.intake = fixtureIntake({ needs: ["snap_new", "electricity"] });
      test.state.claim.request.mandate = fixtureMandate({ recipientIds: ["snap-pa", "peco-cap"] });
      test.state.allowedFields = ["protectedSnapPacket", "incomeAmount", "zip", "householdSize", "utilityProvider", "accountAuthority"];
      test.options.transports = new Map([["peco-cap:submit", { execute: test.execute }]]);
      await runOneParentJob(test.options); expect(test.execute).toHaveBeenCalledOnce(); expect(test.execute.mock.calls[0][0].programId).toBe("peco-cap");
      expect(test.checker.prepareCapture).not.toHaveBeenCalled(); expect(test.port.execute).not.toHaveBeenCalled();
    });
    it("leaves unknown delivery to read-only reconciliation instead of invoking another private preparation", async () => {
      const test = pendingSetup(); test.state.operations = [{ ...test.raw, state: "delivery_unknown", protectedPacketCurrent: false }];
      await runOneParentJob(test.options); expect(test.checker.prepareCapture).not.toHaveBeenCalled(); expect(test.port.reconcile).toHaveBeenCalledOnce();
      expect(test.port.execute).not.toHaveBeenCalled();
    });
    it("stops before checking or sending after lease authority is cancelled", async () => {
      const test = pendingSetup(); test.state.revoked = true; expect((await runOneParentJob(test.options)).state).toBe("failed");
      expect(test.checker.prepareCapture).not.toHaveBeenCalled(); expect(test.port.execute).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
    });
  });
});

describe("worker consumption of exact new-SNAP Submit", () => {
  async function finalSnapFixture() {
    const test = setup(); await formFixture(test);
    test.state.claim.request.intake = fixtureIntake({ needs: ["snap_new"] });
    test.state.claim.request.mandate = fixtureMandate({ recipientIds: ["snap-pa"] });
    test.state.claim.request.facts = [];
    test.state.allowedFields = ["zip"];
    Object.assign(test.state.template!, { program_id: "snap-pa", needs: ["snap_new"], field_map: { ZIP: "zip" }, required_fields: ["zip"] });
    test.options.transports = new Map([["snap-pa:submit", { execute: test.execute }]]);
    return test;
  }
  function frozen(test: ReturnType<typeof setup>, flag: unknown = true) {
    const operation = test.state.prepared.at(-1)!;
    return { id: operationId, request_version: operation[2], need: operation[9], program_id: operation[3], action: operation[4],
      state: "prepared", idempotency_key: operation[8], packet: JSON.parse(String(operation[5])), artifact_id: operation[10],
      updated_at: fixtureNow.toISOString(), personalActsComplete: true, snapSubmissionAuthorized: flag };
  }

  it("saves review after freezing, consumes the database authorization, then retains the real recorded attempt", async () => {
    const test = await finalSnapFixture();
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.state.prepared).toHaveLength(1);
    expect(test.execute).not.toHaveBeenCalled();
    expect(JSON.parse(String(test.state.saved.at(-1)![4]))).toEqual([expect.objectContaining({ reason: "submission_review", field: "snap_final_submit", resolver: "parent" })]);
    const key = test.state.prepared[0][8];
    test.state.previousArtifact = test.state.artifact;
    const authorized = frozen(test);
    test.state.operations = [authorized];
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.execute).toHaveBeenCalledOnce();
    expect(test.execute.mock.calls[0][0]).toMatchObject({ need: "snap_new", action: "submit", idempotencyKey: key });
    expect(test.state.finished).toHaveLength(1);
    expect(JSON.parse(String(test.state.saved.at(-1)![4]))).not.toContainEqual(expect.objectContaining({ reason: "submission_review" }));
    test.state.operations = [{ ...authorized, state: "sent", evidence: receipt }];
    await runOneParentJob(test.options);
    expect(test.execute).toHaveBeenCalledOnce();
  });

  it.each(["missing", "false", "wrong_key"])("keeps %s authorization at review without beginning transport", async kind => {
    const test = await finalSnapFixture(); await runOneParentJob(test.options);
    test.state.previousArtifact = test.state.artifact;
    const previous = frozen(test, kind === "false" ? false : true);
    if (kind === "missing") delete (previous as Partial<typeof previous>).snapSubmissionAuthorized;
    if (kind === "wrong_key") previous.idempotency_key = "another-current-packet";
    test.state.operations = [previous];
    await runOneParentJob(test.options);
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_begin_operation"))).toBe(false);
    expect(JSON.parse(String(test.state.saved.at(-1)![4]))).toContainEqual(expect.objectContaining({ reason: "submission_review" }));
  });

  it.each(["true", 1, null, [], {}])("rejects malformed database authorization %j before a transport can run", async flag => {
    const test = await finalSnapFixture(); await runOneParentJob(test.options);
    const previous = frozen(test, flag); test.state.operations = [previous];
    expect(() => normalizeWorkerOperation(previous)).toThrow();
    await expect(runOneParentJob(test.options)).rejects.toThrow();
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.state.finished).toEqual([]);
  });

  it.each(["missing", false, true])("normalizes only strict boolean %s as the recorded choice", async flag => {
    const test = await finalSnapFixture(); await runOneParentJob(test.options);
    const previous = frozen(test, flag);
    if (flag === "missing") delete (previous as Partial<typeof previous>).snapSubmissionAuthorized;
    expect(normalizeWorkerOperation(previous)?.snapSubmissionAuthorized).toBe(flag === true);
  });

  it("does not promote a preparation-only form when a prior operation has authorization", async () => {
    const test = await finalSnapFixture(); await runOneParentJob(test.options);
    test.state.operations = [frozen(test)]; test.state.previousArtifact = test.state.artifact;
    test.state.template!.preparation_only = true;
    await runOneParentJob(test.options);
    expect(test.state.prepared.at(-1)?.[4]).toBe("prepare");
    expect(test.execute).not.toHaveBeenCalled();
    expect(JSON.parse(String(test.state.saved.at(-1)![4]))).not.toContainEqual(expect.objectContaining({ reason: "submission_review" }));
  });
});

describe("private full-answer SNAP worker preview", () => {
  function previewSetup() {
    const test = setup(), now = new Date("2026-11-03T21:00:00Z"), snapshot = fixtureSnapSnapshot(now);
    test.state.claim.request = fixtureRequest({ version: 2, intake: fixtureIntake({ needs: ["snap_new"], householdSize: 1 }),
      mandate: fixtureMandate({ mode: "prepare_only", recipientIds: ["snap-pa"], allowedActions: ["research", "prepare"], expiresAt: "2026-11-25T21:00:00Z" }) });
    test.state.capabilityEnabled = false;
    test.state.templateBytes = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf");
    test.state.leaseExpiresAt = "2026-11-03T21:05:00Z";
    test.options.now = () => now;
    test.options.coordinate = vi.fn(async ({ request }) => ({ plan: buildSupportPlan(request, now), requiredActions: [], modelCalls: 0, inputTokens: 0, outputTokens: 0 }));
    test.state.preview = { snapshot, snapshotHash: "d".repeat(64), dataCategories: ["household", "income"], artifact: null,
      template: { id: SNAP_PREVIEW_TEMPLATE_ID, version: SNAP_PREVIEW_TEMPLATE_VERSION, program_id: "snap-pa", needs: ["snap_new"],
        content_sha256: SNAP_DRAFT_CONTRACT.sha256, object_path: "snap-preview-source.pdf", field_map: {}, required_fields: [], personal_fields: [],
        required_acts: [], active: true, preparation_only: true, verified_until: SNAP_DRAFT_CONTRACT.verifiedUntil } };
    return { ...test, snapshot };
  }
  function previousPreview(test: ReturnType<typeof previewSetup>) {
    return { id: artifactId, object_path: "existing-preview.pdf", content_sha256: "b".repeat(64), request_id: test.state.claim.request.id,
      request_version: 2, snap_snapshot_id: test.snapshot.id, snap_snapshot_hash: "d".repeat(64), template_id: SNAP_PREVIEW_TEMPLATE_ID,
      template_version: SNAP_PREVIEW_TEMPLATE_VERSION, template_hash: SNAP_DRAFT_CONTRACT.sha256, preparation_only: true, status: "stored", expires_at: SNAP_DRAFT_CONTRACT.verifiedUntil };
  }
  it("renders privately in background and freezes only an ordinary packet plus opaque artifact", async () => {
    const test = previewSetup();
    expect(await runOneParentJob(test.options)).toEqual({ state: "saved" });
    expect(test.state.uploaded.length).toBeGreaterThan(400000);
    expect(test.state.privatePrepared[0].slice(0, 4)).toEqual([jobId, leaseToken, 2, artifactId]);
    expect(test.state.prepared).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(test.options.coordinate!).mock.calls)).not.toContain("Private Canary");
    expect(JSON.stringify(test.state.privatePrepared)).not.toContain(test.snapshot.id);
    expect(JSON.stringify(test.state.events)).not.toContain("Private Canary");
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_register_form_artifact"))).toBe(false);
  });
  it("reuses only the exact leased binding after reassessing original evidence", async () => {
    const test = previewSetup();
    test.state.preview!.artifact = previousPreview(test);
    await runOneParentJob(test.options);
    expect(test.state.privatePrepared[0][3]).toBe(artifactId);
    expect(test.state.uploaded).toHaveLength(0); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("prepares from fresh private facts when the ordinary routing ZIP is stale, without copying it or asking again", async () => {
    const test = previewSetup(); test.state.claim.request.intake_confirmed_at = { zip: "2026-08-01T12:00:00Z" };
    await runOneParentJob(test.options);
    expect(test.state.privatePrepared).toHaveLength(1); expect(test.state.prepared).toHaveLength(0);
    expect(JSON.parse(String(test.state.saved[0][4]))).toEqual([]);
    expect(test.state.claim.request.intake_confirmed_at.zip).toBe("2026-08-01T12:00:00Z");
  });
  it.each(["stale", "missing"])("routes %s private ZIP to exactly one grouped action even when ordinary ZIP is stale", async kind => {
    const test = previewSetup(); test.state.claim.request.intake_confirmed_at = { zip: "2026-08-01T12:00:00Z" };
    if (kind === "stale") test.snapshot.provenance.zip.asOf = "2026-01-01";
    else { delete test.snapshot.details.zip; delete test.snapshot.provenance.zip; }
    await runOneParentJob(test.options);
    expect(test.state.privatePrepared).toHaveLength(0); expect(test.fetcher).not.toHaveBeenCalled();
    expect(JSON.parse(String(test.state.saved[0][4]))).toEqual([expect.objectContaining({ field: "snap_application_details", reason: "missing_fact", resolver: "parent" })]);
  });
  it("keeps non-Philadelphia private coverage a service issue without leaking it into ordinary packets", async () => {
    const test = previewSetup(); test.snapshot.details.zip = "15213";
    await runOneParentJob(test.options);
    expect(test.state.privatePrepared).toHaveLength(0); expect(test.fetcher).not.toHaveBeenCalled();
    expect(JSON.parse(String(test.state.saved[0][4]))).toEqual([expect.objectContaining({ reason: "execution_issue", resolver: "operator" })]);
  });
  it("routes missing or stale answers to the grouped editor without reusing an artifact or asking for approval", async () => {
    const test = previewSetup();
    test.snapshot.provenance["address.street"].asOf = "2026-08-01";
    test.state.preview!.artifact = previousPreview(test);
    await runOneParentJob(test.options);
    expect(test.state.prepared).toHaveLength(0); expect(test.fetcher).not.toHaveBeenCalled();
    const actions = JSON.parse(String(test.state.saved[0][4]));
    expect(actions).toEqual([expect.objectContaining({ field: "snap_application_details", reason: "missing_fact", resolver: "parent" })]);
  });
  it("keeps unsupported layout with CaseLink and registers no partial PDF", async () => {
    const test = previewSetup();
    const details = fixtureSnapSnapshot().details;
    details.applicant!.firstName = "A".repeat(80); details.household![0].firstName = "A".repeat(80);
    test.state.preview!.snapshot = fixtureSnapSnapshot(new Date("2026-11-03T21:00:00Z"), details);
    await runOneParentJob(test.options);
    expect(test.state.prepared).toHaveLength(0); expect(test.state.uploaded).toHaveLength(0);
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_register_snap_application_preview"))).toBe(false);
    const actions = JSON.parse(String(test.state.saved[0][4]));
    expect(actions).toEqual([expect.objectContaining({ reason: "execution_issue", resolver: "operator" })]);
  });
  it("rejects a reused artifact whose snapshot binding differs from the current private read", async () => {
    const test = previewSetup(); test.state.preview!.artifact = { ...previousPreview(test), snap_snapshot_hash: "a".repeat(64) };
    await runOneParentJob(test.options);
    expect(test.state.prepared).toHaveLength(0); expect(test.fetcher).not.toHaveBeenCalled();
  });
  it("does not upload after a correction wins the register-time authority check", async () => {
    const test = previewSetup(); test.state.previewRegisterDenied = true;
    await runOneParentJob(test.options);
    expect(test.state.uploaded).toHaveLength(0); expect(test.state.prepared).toHaveLength(0);
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("cannot freeze an operation after a correction wins the final preparation check", async () => {
    const test = previewSetup(); test.state.previewPrepareDenied = true;
    await runOneParentJob(test.options);
    expect(test.database.query.mock.calls.some(([sql]) => sql.includes("parent_prepare_snap_application_preview"))).toBe(true);
    expect(test.state.privatePrepared).toHaveLength(0); expect(test.state.prepared).toHaveLength(0);
    expect(test.execute).not.toHaveBeenCalled();
  });
});
