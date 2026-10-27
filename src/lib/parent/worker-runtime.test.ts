import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { DocumentProcessingError } from "./document-processing";
import { buildSupportPlan, requiredActions } from "./planning";
import {
  fixtureIntake,
  fixtureMandate,
  fixtureNow,
  fixtureRequest,
} from "./test-fixtures";
import {
  normalizeWorkerOperation,
  PARENT_TRANSPORTS,
  runOneParentJob,
  type RuntimeTransport,
  type WorkerRuntimeOptions,
} from "./worker-runtime";

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
    prepared: [] as unknown[][],
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
    artifact: null as Record<string, unknown> | null,
    uploaded: new Uint8Array() as Uint8Array,
    source: new Uint8Array([37, 80, 68, 70, 45, 49]),
    budget: true,
    revoked: false,
    badDownloadOrigin: false,
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
          value = "2026-10-25T16:05:00Z";
          break;
        case "parent_get_operations":
          value = state.operations;
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
          value = operationId;
          break;
        case "parent_begin_operation": {
          const prepared = state.prepared.at(-1)!;
          value = {
            operationId,
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
                signedUrl: `${state.badDownloadOrigin ? "https://unexpected.example" : "http://127.0.0.1:55321"}/storage/v1/object/sign/${purpose.bucket}/${purpose.objectPath}?token=synthetic`,
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
        plan: buildSupportPlan(input.request.intake, input.request.mandate, fixtureNow),
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
  it("downloads only through a scoped broker, consumes actual document facts and sends only authorized attachments", async () => {
    const test = setup();
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
  it("preserves audited operator attribution and never promotes a parent report to agency evidence", () => {
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
        observedAt: fixtureNow.toISOString(),
      },
    };
    expect(normalizeWorkerOperation(raw)?.receipt?.source).toBe(
      "operator_confirmed",
    );
    expect(
      normalizeWorkerOperation({
        ...raw,
        evidence: { ...raw.evidence, source: "parent_reported" },
      }),
    ).toBeNull();
  });
});
