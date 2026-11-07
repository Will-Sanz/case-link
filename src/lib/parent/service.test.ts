import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DOCUMENT_CONSENT_VERSION } from "./constants";
import { buildSupportPlan, requiredActions } from "./planning";
import { authorizeOperation } from "./policy";
import {
  fixtureIntake,
  fixtureMandate,
  fixtureNow,
  fixtureRequest,
  fixtureProtectedSnapOperation,
} from "./test-fixtures";
import {
  runSupportService,
  type ServiceCapability,
  type ServiceDocument,
  type ServiceExecutionResult,
  type ServiceOperation,
  type ServicePorts,
  type ServiceProposedOperation,
  type ServiceReceipt,
} from "./service";
import type { ExtractedFacts } from "./documents";
import type { SupportRequest } from "./domain";
import { factAnswerSchema } from "./answers";

const receipt = (
  state: ServiceReceipt["state"] = "sent",
  at = fixtureNow.toISOString(),
): ServiceReceipt => ({
  state,
  source: "provider_api",
  reference: "synthetic-provider-reference",
  recordedAt: at,
});
function capability(programId: string): ServiceCapability {
  return {
    programId,
    enabled: true,
    actions: ["submit", "share", "schedule", "follow_up"],
    permissionReference: "synthetic-permission",
    permissionExpiresAt: "2026-11-20T00:00:00Z",
    dataCategories: ["household", "income", "utility", "documents"],
    personalActsComplete: true,
    permissionVersion: "synthetic-permission",
    protectedSubmissionConfigured: true,
  };
}
function setup(request = fixtureRequest()) {
  const ports: ServicePorts = {
    coordinate: vi.fn(async (request) => ({
      plan: buildSupportPlan(request, fixtureNow),
      requiredActions: requiredActions(request.intake, request.mandate),
      modelCalls: 1,
      inputTokens: 100,
      outputTokens: 100,
    })),
    extractDocument: vi.fn(async () => {
      throw new Error("No registered reader");
    }),
    saveDocumentFacts: vi.fn(async () => {}),
    capability: vi.fn(async (programId) => capability(programId)),
    execute: vi.fn(
      async (
        operation: ServiceProposedOperation,
      ): Promise<ServiceExecutionResult> => {
        const decision = authorizeOperation({
          request,
          operation,
          capability: capability(operation.programId),
          accountActive: true,
          attempts: 0,
          now: fixtureNow,
          revoked: false,
          documentsValid: true,
          statusReferences: ["synthetic-provider-reference"],
        });
        return decision.allowed
          ? { state: "sent", receipt: receipt() }
          : { state: "blocked", reason: decision.reason };
      },
    ),
    prepareOperation: vi.fn(async () => {}),
    personalActsComplete: vi.fn(async () => false),
    reconcile: vi.fn(async () => null),
    fillForm: vi.fn(async () => null),
    notify: vi.fn(async () => {}),
  };
  return {
    request,
    ports,
    documents: [] as ServiceDocument[],
    now: fixtureNow,
  };
}
describe("service adoption of the exact protected SNAP operation", () => {
  function protectedSetup(authorized = false) {
    const test = setup(fixtureRequest({ intake: fixtureIntake({ needs: ["snap_new"], zip: "19000" }), mandate: fixtureMandate({ recipientIds: ["snap-pa"] }) }));
    const canonical = fixtureProtectedSnapOperation({ personalActsComplete: authorized, snapSubmissionAuthorized: authorized });
    const previous: ServiceOperation = { id: canonical.operationId, need: "snap_new", programId: "snap-pa", action: "submit", state: "prepared",
      idempotencyKey: canonical.idempotencyKey, packet: canonical.packet, updatedAt: fixtureNow.toISOString(), protectedSnap: canonical, snapSubmissionAuthorized: authorized };
    return { ...test, operations: [previous], canonical };
  }
  it("shows one genuine Submit for an already-frozen exact PDF without refilling or repeated intake", async () => {
    const test = protectedSetup(); const result = await runSupportService(test);
    expect(test.ports.fillForm).not.toHaveBeenCalled(); expect(test.ports.prepareOperation).not.toHaveBeenCalled(); expect(test.ports.execute).not.toHaveBeenCalled();
    expect(result.requiredActions).toEqual([expect.objectContaining({ reason: "submission_review", field: "snap_final_submit", resolver: "parent" })]);
  });
  it("continues the exact authorized operation with its existing key and records only transport acknowledgement", async () => {
    const test = protectedSetup(true); const result = await runSupportService(test);
    expect(test.ports.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ idempotencyKey: test.canonical.idempotencyKey,
      packet: test.canonical.packet, protectedSnap: test.canonical, documentIds: [] }));
    expect(test.ports.fillForm).not.toHaveBeenCalled(); expect(test.ports.prepareOperation).not.toHaveBeenCalled();
    expect(result.plan.routes[0].state).toBe("sent"); expect(result.requiredActions).toEqual([]);
  });
  it.each(["expired", "ambiguous", "wrong_owner", "wrong_hash", "unbound"])("keeps %s canonical work with the service without choosing a different PDF", async kind => {
    const test = protectedSetup(true);
    if (kind === "expired") test.canonical.protectedPacketCurrent = false;
    if (kind === "ambiguous") test.operations.push({ ...test.operations[0], id: "11111111-1111-4111-8111-111111111111" });
    if (kind === "wrong_owner") test.canonical.requestId = "11111111-1111-4111-8111-111111111111";
    if (kind === "wrong_hash") test.canonical.packet = { protectedSnapPacket: { ...test.canonical.packet.protectedSnapPacket, contentSha256: "e".repeat(64) } };
    if (kind === "unbound") delete test.operations[0].protectedSnap;
    const result = await runSupportService(test);
    expect(test.ports.execute).not.toHaveBeenCalled(); expect(test.ports.fillForm).not.toHaveBeenCalled();
    expect(result.requiredActions).toEqual([expect.objectContaining({ reason: "execution_issue", resolver: "operator" })]);
  });
  it("does not turn changed personal evidence into a repeated signing prompt", async () => {
    const test = protectedSetup(true); test.canonical.personalActsComplete = false;
    const result = await runSupportService(test); expect(test.ports.execute).not.toHaveBeenCalled();
    expect(result.requiredActions).toEqual([expect.objectContaining({ reason: "execution_issue", resolver: "operator" })]);
  });
  it("does not offer an unusable first Submit while another actor's required evidence is missing", async () => {
    const test = protectedSetup(); test.canonical.protectedParentSubmitReady = false;
    const result = await runSupportService(test);
    expect(result.requiredActions).toEqual([expect.objectContaining({ reason: "execution_issue", resolver: "operator" })]);
    expect(result.requiredActions.some(action => action.reason === "submission_review")).toBe(false);
    expect(test.ports.execute).not.toHaveBeenCalled(); expect(test.ports.prepareOperation).not.toHaveBeenCalled();
  });
  it.each([undefined, false])("does not offer protected Submit when sender configuration is %s", async configured => {
    const test = protectedSetup(); vi.mocked(test.ports.capability).mockImplementation(async programId => ({ ...capability(programId), protectedSubmissionConfigured: configured }));
    const result = await runSupportService(test);
    expect(result.requiredActions).toEqual([expect.objectContaining({ reason: "execution_issue", resolver: "operator" })]);
    expect(result.requiredActions.some(action => action.reason === "submission_review")).toBe(false); expect(test.ports.execute).not.toHaveBeenCalled();
  });
});

function document(
  requestId: string,
  overrides: Partial<ServiceDocument> = {},
): ServiceDocument {
  return {
    id: "fc7c3eb6-c87e-4ed4-8601-e0f83ab3dd56",
    request_id: requestId,
    filename: "synthetic-bill.pdf",
    media_type: "application/pdf",
    size_bytes: 100,
    status: "uploaded",
    expires_at: "2026-11-01T16:00:00Z",
    created_at: fixtureNow.toISOString(),
    consentVersion: DOCUMENT_CONSENT_VERSION,
    ...overrides,
  };
}
const facts: ExtractedFacts = {
  provider: "peco",
  amountDue: 50,
  totalBalance: 100,
  dueDate: "2026-11-01",
  shutoffDate: null,
  fields: [
    { field: "provider", page: 1, sourceText: "PECO" },
    { field: "amountDue", page: 1, sourceText: "Amount due $50.00" },
    { field: "totalBalance", page: 1, sourceText: "Total balance $100.00" },
    { field: "dueDate", page: 1, sourceText: "Due date 2026-11-01" },
  ],
};
const sourcePages = [
  "PECO\nAmount due $50.00\nTotal balance $100.00\nDue date 2026-11-01",
];
function acknowledged(
  request: SupportRequest,
  state: ServiceReceipt["state"] = "sent",
  at = "2026-10-25T14:00:00.000Z",
): ServiceOperation {
  return {
    id: "synthetic-operation",
    need: "electricity",
    programId: "peco-cap",
    action: "submit",
    state,
    idempotencyKey: "synthetic-operation-key",
    packet: { zip: request.intake.zip },
    updatedAt: at,
    receipt: receipt(state, at),
  };
}
function singleUtilityRequest(): SupportRequest {
  return fixtureRequest({
    intake: fixtureIntake({ needs: ["electricity"] }),
    mandate: fixtureMandate({ recipientIds: ["peco-cap"] }),
  });
}

function finalSnapFixture() {
  const input = setup(fixtureRequest({ intake: fixtureIntake({ needs: ["snap_new"] }),
    mandate: fixtureMandate({ recipientIds: ["snap-pa"] }) }));
  vi.mocked(input.ports.fillForm).mockImplementation(async (programId, packet) => ({
    programId, templateId: "synthetic-complete-snap-form", version: "1", validated: true,
    artifactId: "synthetic-final-artifact", contentSha256: "a".repeat(64),
    formInputDigest: createHash("sha256").update(JSON.stringify(packet)).digest("hex"),
    missingFields: [], personalActs: [],
  }));
  return input;
}
function frozenSnap(operation: ServiceProposedOperation): ServiceOperation {
  return { id: "synthetic-final-snap-operation", need: operation.need, programId: operation.programId,
    action: operation.action, state: "prepared", idempotencyKey: operation.idempotencyKey,
    packet: operation.packet, updatedAt: fixtureNow.toISOString(), snapSubmissionAuthorized: true };
}

describe("new SNAP final Submit orchestration", () => {
  it("freezes the exact final operation for review and executes it only after its explicit authorization", async () => {
    const input = finalSnapFixture();
    const waiting = await runSupportService(input);
    expect(input.ports.execute).not.toHaveBeenCalled();
    expect(waiting.requiredActions).toEqual([expect.objectContaining({ need: "snap_new", reason: "submission_review", field: "snap_final_submit", resolver: "parent" })]);
    expect(waiting.requiredActions[0].url).toBeUndefined();
    expect(waiting.nextActor).toBe("parent");
    expect(waiting.nextTrigger).toBe("parent_action_completed");
    expect(waiting.plan.routes[0]).toMatchObject({ state: "prepared", nextActor: "parent" });
    expect(waiting.plan.routes[0].limitation).toBe("Your prepared SNAP application is ready for your review. Nothing has been sent.");
    const operation = vi.mocked(input.ports.prepareOperation).mock.calls[0][0];
    expect(operation).toMatchObject({ need: "snap_new", action: "submit", form: { artifactId: "synthetic-final-artifact" } });
    const authorized = frozenSnap(operation);
    await runSupportService({ ...input, operations: [{ ...authorized, snapSubmissionAuthorized: false }] });
    expect(input.ports.execute).not.toHaveBeenCalled();
    const submitted = await runSupportService({ ...input, operations: [authorized] });
    expect(input.ports.execute).toHaveBeenCalledExactlyOnceWith(operation);
    expect(submitted.plan.routes[0].state).toBe("sent");
    expect(submitted.requiredActions.some(action => action.reason === "submission_review")).toBe(false);
  });

  it.each([undefined, false, "true", 1, null])("does not treat the flag %s as parent authorization", async flag => {
    const input = finalSnapFixture(); await runSupportService(input);
    const operation = vi.mocked(input.ports.prepareOperation).mock.calls[0][0];
    const previous = { ...frozenSnap(operation), snapSubmissionAuthorized: flag } as unknown as ServiceOperation;
    const result = await runSupportService({ ...input, operations: [previous] });
    expect(input.ports.execute).not.toHaveBeenCalled();
    expect(result.requiredActions).toContainEqual(expect.objectContaining({ reason: "submission_review", field: "snap_final_submit" }));
  });

  it.each(["idempotency_key", "request_version", "packet", "final_bytes", "need", "program", "action", "state"])("does not reuse authorization for a changed %s", async change => {
    const input = finalSnapFixture(); await runSupportService(input);
    const operation = vi.mocked(input.ports.prepareOperation).mock.calls[0][0];
    const previous = frozenSnap(operation);
    if (change === "idempotency_key") previous.idempotencyKey = "another-exact-packet";
    if (change === "request_version") input.request.version++;
    if (change === "packet") input.request.intake.householdSize = (input.request.intake.householdSize ?? 3) + 1;
    if (change === "final_bytes") vi.mocked(input.ports.fillForm).mockImplementation(async (programId, packet) => ({
      programId, templateId: "synthetic-complete-snap-form", version: "1", validated: true,
      artifactId: "synthetic-corrected-artifact", contentSha256: "b".repeat(64),
      formInputDigest: createHash("sha256").update(JSON.stringify(packet)).digest("hex"), missingFields: [], personalActs: [],
    }));
    if (change === "need") previous.need = "snap_renewal";
    if (change === "program") previous.programId = "uesf-benefits";
    if (change === "action") previous.action = "prepare";
    if (change === "state") previous.state = "unresolved";
    await runSupportService({ ...input, operations: [previous] });
    expect(input.ports.execute).not.toHaveBeenCalled();
  });

  it("requires genuine personal acts before final review and cannot substitute the Submit decision for them", async () => {
    const input = finalSnapFixture();
    vi.mocked(input.ports.capability).mockImplementation(async programId => ({ ...capability(programId), personalActsComplete: false,
      requiredPersonalActs: [{ id: "signature", title: "Sign the official application", explanation: "The synthetic verified form requires your genuine signature." }] }));
    const first = await runSupportService(input);
    const operation = vi.mocked(input.ports.prepareOperation).mock.calls[0][0];
    expect(first.requiredActions).toEqual([expect.objectContaining({ reason: "personal_step" })]);
    const forgedShortcut = await runSupportService({ ...input, operations: [frozenSnap(operation)] });
    expect(forgedShortcut.requiredActions).toEqual([expect.objectContaining({ reason: "personal_step" })]);
    expect(input.ports.execute).not.toHaveBeenCalled();
    vi.mocked(input.ports.personalActsComplete).mockResolvedValue(true);
    const review = await runSupportService(input);
    expect(review.requiredActions).toEqual([expect.objectContaining({ reason: "submission_review" })]);
    const submitted = await runSupportService({ ...input, operations: [frozenSnap(operation)] });
    expect(input.ports.execute).toHaveBeenCalledExactlyOnceWith(operation);
    expect(submitted.requiredActions.some(action => action.reason === "personal_step" || action.reason === "submission_review")).toBe(false);
  });

  it.each(["snap_renewal", "snap_pending", "snap_problem", "wic_new", "wic_continuing"] as const)("does not borrow an enabled program submission for the unsupported %s journey", async need => {
    const program = need.startsWith("snap_") ? "snap-pa" : "wic-pa";
    const input = setup(fixtureRequest({ intake: fixtureIntake({ needs: [need] }), mandate: fixtureMandate({ recipientIds: [program] }) }));
    const result = await runSupportService(input);
    expect(input.ports.execute).not.toHaveBeenCalled(); expect(input.ports.prepareOperation).not.toHaveBeenCalled();
    expect(result.requiredActions).toEqual(expect.arrayContaining([expect.objectContaining({ need, reason: "execution_issue", resolver: "operator" })]));
  });
  it("adds no routine final approval step for food_now", async () => {
    const need = "food_now", program = "philly-food";
    const input = setup(fixtureRequest({ intake: fixtureIntake({ needs: [need] }), mandate: fixtureMandate({ recipientIds: [program] }) }));
    const result = await runSupportService(input);
    expect(input.ports.execute).toHaveBeenCalledOnce();
    expect(input.ports.prepareOperation).not.toHaveBeenCalled();
    expect(result.requiredActions.some(action => action.reason === "submission_review")).toBe(false);
  });

  it("does not ask for another final click on a new-SNAP follow-up", async () => {
    const input = finalSnapFixture();
    const prior = { ...acknowledged(input.request, "sent", "2026-10-24T10:00:00Z"), need: "snap_new" as const, programId: "snap-pa" };
    input.request.plan = buildSupportPlan(input.request, fixtureNow);
    input.request.plan.routes[0].state = "sent";
    const result = await runSupportService({ ...input, operations: [prior] });
    expect(input.ports.execute).toHaveBeenCalledWith(expect.objectContaining({ action: "follow_up" }));
    expect(result.requiredActions.some(action => action.reason === "submission_review")).toBe(false);
  });

  it("keeps an incomplete private preview in preparation even with an unrelated true authorization", async () => {
    const input = finalSnapFixture(); await runSupportService(input);
    const operation = vi.mocked(input.ports.prepareOperation).mock.calls[0][0];
    vi.mocked(input.ports.fillForm).mockImplementation(async (programId, packet) => ({
      programId, templateId: "synthetic-private-preview", version: "1", validated: true, preparationOnly: true,
      artifactId: "synthetic-incomplete-preview", contentSha256: "b".repeat(64),
      formInputDigest: createHash("sha256").update(JSON.stringify(packet)).digest("hex"), missingFields: [], personalActs: [],
    }));
    const result = await runSupportService({ ...input, operations: [frozenSnap(operation)] });
    expect(vi.mocked(input.ports.prepareOperation).mock.calls.at(-1)?.[0].action).toBe("prepare");
    expect(input.ports.execute).not.toHaveBeenCalled();
    expect(result.requiredActions.some(action => action.reason === "submission_review")).toBe(false);
    expect(result.requiredActions).toContainEqual(expect.objectContaining({ reason: "execution_issue", resolver: "operator" }));
  });
});

describe("parent service orchestration", () => {
  it("routes each need by its current ZIP instead of another need's mirror", async () => {
    const request = fixtureRequest({
      intake: fixtureIntake({ zip: "10001" }),
      intake_need_scoped_fields: ["zip"],
      facts: [
        { need: "food_now", field: "zip", value: "19104", source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" },
        { need: "electricity", field: "zip", value: "10001", source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" },
      ],
    });
    const input = setup(request);
    const result = await runSupportService(input);
    expect(input.ports.execute).toHaveBeenCalledWith(expect.objectContaining({ need: "food_now", packet: expect.objectContaining({ zip: "19104" }) }));
    expect(vi.mocked(input.ports.execute).mock.calls.some(([operation]) => operation.need === "electricity")).toBe(false);
    expect(result.plan.routes.find((route) => route.need === "food_now")?.state).toBe("sent");
  });

  it("reconciles an existing receipt before checking new-work geographic coverage", async () => {
    const request = singleUtilityRequest();
    request.intake.zip = "10001";
    request.created_at = new Date(fixtureNow.getTime() - 46 * 86400000).toISOString();
    const input = setup(request);
    const pending: ServiceOperation = { ...acknowledged(request), state: "delivery_unknown", receipt: undefined };
    input.ports.reconcile = vi.fn(async () => receipt("partner_received"));
    const result = await runSupportService({ ...input, operations: [pending] });
    expect(input.ports.reconcile).toHaveBeenCalledWith(pending);
    expect(result.plan.routes[0].state).toBe("partner_received");
    expect(result.requiredActions.some((action) => action.field === "zip")).toBe(false);
  });

  it("gathers CaseLink routing and actual form facts together before a new service action", async () => {
    const request = fixtureRequest({
      intake: fixtureIntake({ needs: ["food_now"], zip: "10001" }),
      mandate: fixtureMandate({ recipientIds: ["philly-food"] }),
      created_at: new Date(fixtureNow.getTime() - 46 * 86400000).toISOString(),
    });
    const input = setup(request);
    vi.mocked(input.ports.fillForm).mockImplementation(async (programId, packet) => ({
      programId, templateId: "synthetic-household-form", version: "1", validated: true,
      formInputDigest: createHash("sha256").update(JSON.stringify(packet)).digest("hex"),
      missingFields: ["householdSize"], personalActs: [],
    }));
    const result = await runSupportService(input);
    expect(result.requiredActions.filter((action) => action.reason === "missing_fact").map((action) => action.field).sort()).toEqual(["householdSize", "zip"]);
    expect(result.requiredActions.find((action) => action.field === "zip")?.explanation).toContain("CaseLink");
    expect(input.ports.execute).not.toHaveBeenCalled();
  });

  it("checks a known case after a move without requesting a fresh ZIP", async () => {
    const request = singleUtilityRequest();
    request.intake.zip = "10001";
    request.created_at = new Date(fixtureNow.getTime() - 46 * 86400000).toISOString();
    const input = setup(request);
    const result = await runSupportService({
      ...input, operations: [acknowledged(request, "sent", "2026-10-20T16:00:00Z")],
    });
    expect(input.ports.execute).toHaveBeenCalledWith(expect.objectContaining({
      action: "follow_up", packet: { statusReference: "synthetic-provider-reference" },
    }));
    expect(result.requiredActions.some((action) => action.field === "zip")).toBe(false);
  });
  it("gathers routing, booking choice and known form facts in one appointment response", async () => {
    const request = fixtureRequest({
      intake: fixtureIntake({ needs: ["food_now"], zip: "10001" }),
      mandate: fixtureMandate({ recipientIds: ["philly-food"], bookingPreference: "ask_me" }),
      created_at: new Date(fixtureNow.getTime() - 46 * 86400000).toISOString(),
    });
    const input = setup(request);
    vi.mocked(input.ports.capability).mockImplementation(async (programId) => ({ ...capability(programId), actions: ["schedule"] }));
    vi.mocked(input.ports.fillForm).mockImplementation(async (programId, packet) => ({
      programId, templateId: "synthetic-appointment-form", version: "1", validated: true,
      formInputDigest: createHash("sha256").update(JSON.stringify(packet)).digest("hex"),
      missingFields: ["householdSize"], personalActs: [],
    }));
    const result = await runSupportService(input);
    expect(result.requiredActions.filter((action) => action.resolver !== "operator").map((action) => action.field).sort()).toEqual(["bookingPreference", "householdSize", "zip"]);
    expect(input.ports.execute).not.toHaveBeenCalled();
    expect(input.ports.prepareOperation).not.toHaveBeenCalled();
  });

  it("requests routing permission before collecting a ZIP and keeps internal routing out of a utility-only packet", async () => {
    const request = singleUtilityRequest();
    request.mandate.allowedData = ["utility"];
    const input = setup(request);
    vi.mocked(input.ports.capability).mockImplementation(async (programId) => ({
      ...capability(programId), dataCategories: ["utility"], allowedFields: ["utilityProvider", "accountAuthority"],
    }));
    const waiting = await runSupportService(input);
    expect(waiting.requiredActions).toContainEqual(expect.objectContaining({ reason: "expanded_permission", field: "allowedData" }));
    expect(waiting.requiredActions.some((action) => action.reason === "missing_fact" && action.field === "zip")).toBe(false);
    expect(input.ports.execute).not.toHaveBeenCalled();
    request.mandate.allowedData = ["household", "utility"];
    request.version++;
    await runSupportService(input);
    const operation = vi.mocked(input.ports.execute).mock.calls[0][0];
    expect(operation.dataCategories).toEqual(["utility"]);
    expect(operation.packet).not.toHaveProperty("zip");
    expect(operation.packet).not.toHaveProperty("householdSize");
  });

  it("keeps an authorized alternative available while waiting for current routing evidence", async () => {
    const request = fixtureRequest({
      intake: fixtureIntake({ needs: ["snap_new"], zip: "10001" }),
      mandate: fixtureMandate({ recipientIds: ["snap-pa", "uesf-benefits"] }),
      created_at: new Date(fixtureNow.getTime() - 46 * 86400000).toISOString(),
    });
    const input = setup(request);
    const declined: ServiceOperation = { ...acknowledged(request, "declined"), need: "snap_new", programId: "snap-pa" };
    const result = await runSupportService({ ...input, operations: [declined] });
    expect(result.plan.routes[0].programId).toBe("uesf-benefits");
    expect(result.requiredActions).toContainEqual(expect.objectContaining({ field: "zip", reason: "missing_fact" }));
    expect(result.plan.routes[0].limitation ?? "").not.toContain("exhausted");
    expect(input.ports.execute).not.toHaveBeenCalled();
  });
  it.each(["stale", "scoped"])(
    "does not execute with %s generic household data and resumes from a current exact-need answer",
    async (source) => {
      const request = fixtureRequest({
        intake: fixtureIntake({ needs: ["food_now"] }),
        mandate: fixtureMandate({ recipientIds: ["philly-food"] }),
        created_at: new Date(fixtureNow.getTime() - 46 * 86400000).toISOString(),
        updated_at: fixtureNow.toISOString(),
        intake_confirmed_at: {
          zip: fixtureNow.toISOString(),
          ...(source === "scoped" ? { householdSize: fixtureNow.toISOString() } : {}),
        },
        intake_need_scoped_fields: source === "scoped" ? ["householdSize"] : [],
      });
      const input = setup(request);
      vi.mocked(input.ports.fillForm).mockImplementation(async (programId, packet) => ({
        programId, templateId: "synthetic-household-form", version: "1", validated: true,
        formInputDigest: createHash("sha256").update(JSON.stringify(packet)).digest("hex"),
        missingFields: packet.householdSize === undefined ? ["householdSize"] : [],
        personalActs: [],
        ...(packet.householdSize === undefined ? {} : {
          artifactId: "synthetic-artifact", contentSha256: "a".repeat(64),
        }),
      }));
      const waiting = await runSupportService(input);
      expect(input.ports.execute).not.toHaveBeenCalled();
      expect(waiting.requiredActions).toContainEqual(
        expect.objectContaining({ need: "food_now", field: "householdSize", reason: "missing_fact" }),
      );
      request.facts = [{
        need: "food_now",
        field: "householdSize",
        value: 5,
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      }];
      request.version++;
      const resumed = await runSupportService(input);
      expect(resumed.requiredActions.some((action) => action.field === "householdSize")).toBe(false);
      expect(input.ports.execute).toHaveBeenCalledWith(
        expect.objectContaining({ need: "food_now", packet: expect.objectContaining({ householdSize: 5 }) }),
      );
    },
  );
  it("recovers a narrow existing grant with explicit income permission and one paired answer", async () => {
    const request = singleUtilityRequest();
    request.mandate.allowedData = ["household", "utility"];
    const input = setup(request);
    vi.mocked(input.ports.fillForm).mockImplementation(
      async (programId, packet) => ({
        programId,
        templateId: "synthetic-income-form",
        version: "1",
        validated: true,
        formInputDigest: createHash("sha256")
          .update(JSON.stringify(packet))
          .digest("hex"),
        missingFields: ["incomeAmount", "incomeFrequency"].filter(
          (field) => packet[field] === undefined,
        ),
        personalActs: [],
        ...(packet.incomeAmount !== undefined &&
        packet.incomeFrequency !== undefined
          ? { artifactId: "synthetic-artifact", contentSha256: "a".repeat(64) }
          : {}),
      }),
    );
    const needsPermission = await runSupportService(input);
    expect(request.mandate.allowedData).toEqual(["household", "utility"]);
    expect(
      needsPermission.requiredActions.filter(
        (action) => action.reason === "expanded_permission",
      ),
    ).toEqual([
      expect.objectContaining({ need: "electricity", field: "allowedData" }),
    ]);
    expect(
      needsPermission.requiredActions.some(
        (action) => action.reason === "missing_fact",
      ),
    ).toBe(false);
    expect(input.ports.execute).not.toHaveBeenCalled();

    // This change represents a new explicit parent mandate, never automatic expansion by a worker.
    request.mandate = fixtureMandate({
      recipientIds: ["peco-cap"],
      allowedData: ["household", "utility", "income"],
    });
    request.version++;
    const needsAnswer = await runSupportService(input);
    expect(
      needsAnswer.requiredActions.filter(
        (action) => action.reason === "missing_fact",
      ),
    ).toEqual([
      expect.objectContaining({ need: "electricity", field: "income" }),
    ]);
    const answer = factAnswerSchema.parse({
      need: "electricity",
      field: "income",
      value: { amount: 500, frequency: "weekly" },
      version: request.version,
    });
    request.facts = [
      {
        need: answer.need,
        field: answer.field,
        value: answer.value,
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      },
    ];
    request.version++;
    const resumed = await runSupportService(input);
    expect(
      resumed.requiredActions.some(
        (action) =>
          action.reason === "missing_fact" ||
          action.reason === "expanded_permission",
      ),
    ).toBe(false);
    expect(input.ports.execute).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(input.ports.execute).mock.calls[0][0].packet,
    ).toMatchObject({ incomeAmount: 500, incomeFrequency: "weekly" });
  });
  it("keeps a provider-matched shutoff notice out of the other utility packet", async () => {
    const request = fixtureRequest({
      intake: fixtureIntake({
        needs: ["electricity", "gas"],
        utilityProviders: ["peco", "pgw"],
      }),
      mandate: fixtureMandate({ recipientIds: ["peco-cap", "pgw-crp"] }),
    });
    const input = setup(request);
    input.documents = [
      document(request.id, {
        status: "validated",
        validatedAt: fixtureNow.toISOString(),
        facts: {
          ...facts,
          shutoffDate: "2026-11-05",
          fields: [
            ...facts.fields,
            {
              field: "shutoffDate",
              page: 1,
              sourceText: "Shutoff date 2026-11-05",
            },
          ],
        },
      }),
    ];
    await runSupportService(input);
    const electricity = vi
      .mocked(input.ports.execute)
      .mock.calls.find(([operation]) => operation.need === "electricity")![0];
    const gas = vi
      .mocked(input.ports.execute)
      .mock.calls.find(([operation]) => operation.need === "gas")![0];
    expect(electricity.packet.shutoffDate).toBe("2026-11-05");
    expect(gas.packet.shutoffDate).toBeUndefined();
    expect(gas.documentIds).toEqual([]);
  });
  it("keeps authority, provider and shutoff answers scoped to one utility", async () => {
    const request = fixtureRequest({
      intake: fixtureIntake({
        needs: ["electricity", "gas"],
        utilityProviders: ["unknown"],
        accountAuthority: "not_sure",
      }),
      mandate: fixtureMandate({ recipientIds: ["peco-cap", "pgw-crp"] }),
    });
    request.facts = [
      {
        need: "electricity",
        field: "accountAuthority",
        value: "self",
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      },
      {
        need: "electricity",
        field: "utilityProvider",
        value: "peco",
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      },
      {
        need: "electricity",
        field: "shutoffDate",
        value: "2026-11-02",
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      },
    ];
    const input = setup(request);
    const result = await runSupportService(input);
    expect(
      vi
        .mocked(input.ports.execute)
        .mock.calls.map(([operation]) => operation.need),
    ).toEqual(["electricity"]);
    expect(
      vi.mocked(input.ports.execute).mock.calls[0][0].packet,
    ).toMatchObject({
      accountAuthority: "self",
      utilityProvider: "peco",
      shutoffDate: "2026-11-02",
    });
    expect(result.requiredActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ need: "gas", field: "utilityProvider" }),
      ]),
    );
  });
  it("reuses independently valid derived facts two days after raw deletion without extracting again", async () => {
    const input = setup(singleUtilityRequest());
    input.documents = [
      document(input.request.id, {
        status: "raw_deleted",
        facts,
        validatedAt: "2026-10-23T12:00:00Z",
        sourceObservedAt: "2026-10-20",
        expires_at: "2026-10-24T12:00:00Z",
        factsExpiresAt: "2026-11-01T12:00:00Z",
      }),
    ];
    await runSupportService(input);
    expect(input.ports.extractDocument).not.toHaveBeenCalled();
    const operation = vi.mocked(input.ports.execute).mock.calls[0][0];
    expect(operation.packet.amountDue).toBe(50);
    expect(operation.documentIds).toEqual([]);
  });
  it("uses a fresh typed parent answer over a bill only for the named need", async () => {
    const request = fixtureRequest({
      intake: fixtureIntake({
        needs: ["electricity", "gas"],
        utilityProviders: ["peco", "pgw"],
      }),
      mandate: fixtureMandate({
        recipientIds: ["peco-cap", "pgw-crp"],
        allowedData: ["household", "utility", "documents"],
      }),
    });
    request.facts = [
      {
        need: "electricity",
        field: "amountDue",
        value: 42,
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      },
    ];
    const input = setup(request);
    input.documents = [
      document(request.id, {
        status: "validated",
        facts,
        validatedAt: fixtureNow.toISOString(),
      }),
    ];
    await runSupportService(input);
    const electricity = vi
      .mocked(input.ports.execute)
      .mock.calls.find(([operation]) => operation.need === "electricity")?.[0];
    const gas = vi
      .mocked(input.ports.execute)
      .mock.calls.find(([operation]) => operation.need === "gas")?.[0];
    expect(electricity?.packet.amountDue).toBe(42);
    expect(gas?.packet.amountDue).toBeUndefined();
  });
  it("ignores stale, invalid and out-of-scope parent facts", async () => {
    const request = singleUtilityRequest();
    request.mandate.allowedData = ["household", "utility"];
    request.facts = [
      {
        need: "electricity",
        field: "amountDue",
        value: 42,
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-01-01",
      },
      {
        need: "electricity",
        field: "dueDate",
        value: "2026-02-31",
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      },
      {
        need: "electricity",
        field: "income",
        value: { amount: 200, frequency: "monthly" },
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      },
    ];
    const input = setup(request);
    await runSupportService(input);
    const packet = vi.mocked(input.ports.execute).mock.calls[0][0].packet;
    expect(packet.amountDue).toBeUndefined();
    expect(packet.dueDate).toBeUndefined();
    expect(packet.incomeAmount).toBeUndefined();
  });
  it("executes independent authorized needs through the real packet policy and records distinct receipts", async () => {
    const input = setup();
    const result = await runSupportService(input);
    expect(result.plan.routes.map((route) => route.state)).toEqual([
      "sent",
      "sent",
    ]);
    expect(input.ports.execute).toHaveBeenCalledTimes(2);
    expect(result.events.map((event) => event.need)).toEqual([
      "food_now",
      "electricity",
    ]);
    expect(
      result.events.every((event) => event.receipt?.source === "provider_api"),
    ).toBe(true);
    expect(result.nextTrigger).toBe("scheduled_follow_up");
  });
  it("does no tool work after pause, cancellation or expired authorization", async () => {
    for (const override of [
      { status: "paused" as const },
      { status: "cancelled" as const },
      { mandate: fixtureMandate({ expiresAt: "2026-10-24T00:00:00Z" }) },
    ]) {
      const input = setup(fixtureRequest(override));
      await runSupportService(input);
      expect(input.ports.coordinate).not.toHaveBeenCalled();
      expect(input.ports.execute).not.toHaveBeenCalled();
    }
  });
  it("honors a last-moment executor revocation denial without fabricating success", async () => {
    const input = setup();
    vi.mocked(input.ports.execute).mockResolvedValue({
      state: "blocked",
      reason: "authority_revoked",
    });
    const result = await runSupportService(input);
    expect(
      result.plan.routes.every((route) => route.state === "prepared"),
    ).toBe(true);
    expect(result.events.some((event) => event.kind === "support.sent")).toBe(
      false,
    );
  });
  it.each(["support_received", "delivery_unknown"] as const)(
    "holds a changed provider with prior %s evidence while another utility continues",
    async (state) => {
      const request = fixtureRequest({
        intake: fixtureIntake({
          needs: ["electricity", "gas"],
          utilityProviders: ["peco", "pgw"],
        }),
        mandate: fixtureMandate({ recipientIds: ["peco-cap", "pgw-crp"] }),
      });
      request.facts = [
        {
          need: "electricity",
          field: "utilityProvider",
          value: "other",
          source: "parent",
          confirmedAt: fixtureNow.toISOString(),
          asOf: "2026-10-25",
        },
      ];
      request.account_changed_at = { electricity: fixtureNow.toISOString() };
      const input = setup(request);
      input.documents = [
        document(request.id, {
          created_at: "2026-10-24T12:00:00Z",
          status: "validated",
          facts,
          validatedAt: fixtureNow.toISOString(),
          sourceObservedAt: "2026-10-25",
        }),
      ];
      const oldOperation = acknowledged(request, "support_received");
      oldOperation.createdAt = "2026-10-24T12:00:00Z";
      oldOperation.state = state;
      if (state === "delivery_unknown") {
        oldOperation.receipt = undefined;
        vi.mocked(input.ports.reconcile).mockResolvedValue(
          receipt("support_received"),
        );
      }
      const result = await runSupportService({
        ...input,
        operations: [oldOperation],
      });
      if (state === "delivery_unknown")
        expect(input.ports.reconcile).toHaveBeenCalledWith(oldOperation);
      expect(
        vi
          .mocked(input.ports.execute)
          .mock.calls.map(([operation]) => operation.need),
      ).toEqual(["gas"]);
      expect(
        vi
          .mocked(input.ports.fillForm)
          .mock.calls.every(([, , need]) => need !== "electricity"),
      ).toBe(true);
      expect(
        result.plan.routes.find((route) => route.need === "electricity")?.state,
      ).toBe("unresolved");
      expect(result.requiredActions).toContainEqual(
        expect.objectContaining({
          need: "electricity",
          reason: "execution_issue",
          resolver: "operator",
        }),
      );
      expect(
        vi.mocked(input.ports.execute).mock.calls[0][0].packet.amountDue,
      ).toBeUndefined();
    },
  );
  it("keeps a saved parent bill correction authoritative after an unrelated ZIP edit", async () => {
    const request = singleUtilityRequest();
    request.intake.zip = "19103";
    request.version++;
    request.facts = [
      {
        need: "electricity",
        field: "amountDue",
        value: 80,
        source: "parent",
        confirmedAt: fixtureNow.toISOString(),
        asOf: "2026-10-25",
      },
    ];
    const input = setup(request);
    input.documents = [
      document(request.id, {
        status: "validated",
        facts: {
          ...facts,
          amountDue: 100,
          fields: facts.fields.map((field) =>
            field.field === "amountDue"
              ? { ...field, sourceText: "Amount due $100.00" }
              : field,
          ),
        },
        validatedAt: fixtureNow.toISOString(),
        sourceObservedAt: "2026-10-25",
      }),
    ];
    await runSupportService(input);
    expect(input.ports.extractDocument).not.toHaveBeenCalled();
    expect(
      vi.mocked(input.ports.execute).mock.calls[0][0].packet,
    ).toMatchObject({ zip: "19103", amountDue: 80 });
  });
  it("uses source-validated current document facts automatically without repeating a parent question", async () => {
    const request = singleUtilityRequest();
    request.intake.utilityProviders = ["unknown"];
    const input = setup(request);
    input.documents = [document(request.id)];
    vi.mocked(input.ports.extractDocument).mockResolvedValue({
      facts,
      sourcePages,
    });
    const result = await runSupportService(input);
    expect(input.ports.saveDocumentFacts).toHaveBeenCalledWith(
      input.documents[0].id,
      facts,
      {},
    );
    const operation = vi.mocked(input.ports.execute).mock.calls[0][0];
    expect(operation.packet).toEqual({
      zip: "19104",
      householdSize: 3,
      utilityProvider: "peco",
      accountAuthority: "self",
      amountDue: 50,
      totalBalance: 100,
      dueDate: "2026-11-01",
      documentIds: [input.documents[0].id],
    });
    expect(operation.dataCategories).toEqual([
      "household",
      "utility",
      "documents",
    ]);
    expect(result.plan.routes[0].state).toBe("sent");
    expect(result.requiredActions).toHaveLength(0);
  });
  it("excludes expired, foreign and non-consented documents before extraction", async () => {
    const input = setup(singleUtilityRequest());
    input.documents = [
      document(input.request.id, { expires_at: "2026-10-24T00:00:00Z" }),
      document("another-request"),
      document(input.request.id, { consentVersion: "unapproved" }),
    ];
    await runSupportService(input);
    expect(input.ports.extractDocument).not.toHaveBeenCalled();
    expect(vi.mocked(input.ports.execute).mock.calls[0][0].documentIds).toEqual(
      [],
    );
  });
  it("does not treat a recently extracted old bill as a current source, while food continues", async () => {
    const input = setup();
    input.documents = [
      document(input.request.id, {
        status: "validated",
        facts: { ...facts, dueDate: "2025-01-01" },
        validatedAt: fixtureNow.toISOString(),
      }),
    ];
    const result = await runSupportService(input);
    const utility = vi
      .mocked(input.ports.execute)
      .mock.calls.find((call) => call[0].programId === "peco-cap")![0];
    expect(utility.packet.amountDue).toBeUndefined();
    expect(utility.documentIds).toEqual([]);
    expect(
      result.plan.routes.find((route) => route.need === "food_now")?.state,
    ).toBe("sent");
    expect(
      result.requiredActions.some(
        (action) =>
          action.title === "A document needs a source check" &&
          action.resolver === "operator",
      ),
    ).toBe(true);
  });
  it("keeps parent corrections authoritative instead of using a conflicting document date", async () => {
    const request = singleUtilityRequest();
    request.intake.shutoffDate = "2026-11-10";
    const input = setup(request);
    input.documents = [
      document(request.id, {
        status: "validated",
        facts: { ...facts, shutoffDate: "2026-11-05" },
        validatedAt: fixtureNow.toISOString(),
      }),
    ];
    await runSupportService(input);
    const operation = vi.mocked(input.ports.execute).mock.calls[0][0];
    expect(operation.packet.shutoffDate).toBe("2026-11-10");
    expect(operation.documentIds).toEqual([]);
  });
  it("continues food when one utility capability tool fails", async () => {
    const input = setup();
    vi.mocked(input.ports.capability).mockImplementation(async (programId) => {
      if (programId === "peco-cap") throw new Error("Unavailable");
      return capability(programId);
    });
    const result = await runSupportService(input);
    expect(
      result.plan.routes.find((route) => route.need === "food_now")?.state,
    ).toBe("sent");
    expect(
      result.plan.routes.find((route) => route.need === "electricity")?.state,
    ).toBe("prepared");
    expect(
      result.requiredActions.some(
        (action) =>
          action.need === "electricity" && action.resolver === "operator",
      ),
    ).toBe(true);
  });
  it("reconciles unknown delivery before another attempt and never blindly resubmits", async () => {
    const input = setup(singleUtilityRequest());
    const operation = {
      ...acknowledged(input.request),
      state: "delivery_unknown" as const,
      receipt: undefined,
    };
    const result = await runSupportService({
      ...input,
      unknownOperations: [operation],
    });
    expect(input.ports.reconcile).toHaveBeenCalledWith(operation);
    expect(input.ports.execute).not.toHaveBeenCalled();
    expect(result.nextTrigger).toBe("verified_receipt_available");
    expect(result.nextRunAt).toBeNull();
  });
  it("advances an uncertain attempt only from a validated actual receipt", async () => {
    const input = setup(singleUtilityRequest());
    vi.mocked(input.ports.reconcile).mockResolvedValue(
      receipt("support_received"),
    );
    const operation = {
      ...acknowledged(input.request),
      state: "delivery_unknown" as const,
      receipt: undefined,
    };
    const result = await runSupportService({
      ...input,
      unknownOperations: [operation],
    });
    expect(result.plan.routes[0].state).toBe("support_received");
    expect(input.ports.execute).not.toHaveBeenCalled();
  });
  it("requires receipt evidence rather than trusting an executor state string", async () => {
    const input = setup(singleUtilityRequest());
    vi.mocked(input.ports.execute).mockResolvedValue({
      state: "assistance_approved",
    });
    const result = await runSupportService(input);
    expect(result.plan.routes[0].state).toBe("prepared");
    expect(result.nextTrigger).toBe("verified_receipt_available");
  });
  it("waits without model-driven daily polling for an unconfigured program channel", async () => {
    const input = setup(singleUtilityRequest());
    vi.mocked(input.ports.capability).mockResolvedValue(null);
    const result = await runSupportService(input);
    expect(input.ports.execute).not.toHaveBeenCalled();
    expect(result.nextRunAt).toBeNull();
    expect(result.nextTrigger).toBe("provider_capability_enabled");
    expect(
      result.requiredActions.every((action) => action.resolver === "operator"),
    ).toBe(true);
  });
  it.each(["prepare_only", "full"] as const)(
    "prepares a verified form under %s permission without a delivery channel or repeated personal approval",
    async (mode) => {
      const request = fixtureRequest({
        intake: fixtureIntake({ needs: ["snap_new"] }),
        mandate: fixtureMandate({ mode, recipientIds: ["snap-pa"],
          allowedActions: mode === "prepare_only" ? ["research", "prepare"] : ["research", "prepare", "submit"] }),
      });
      const input = setup(request);
      vi.mocked(input.ports.capability).mockImplementation(async (programId, action) =>
        action === "prepare" ? { ...capability(programId), actions: ["prepare"],
          requiresForm: true, allowedFields: ["zip"] } : null);
      vi.mocked(input.ports.fillForm).mockImplementation(async (programId, packet) => ({
        programId, templateId: "verified-snap-test", version: "1", validated: true,
        artifactId: "owned-prepared-artifact", contentSha256: "a".repeat(64),
        formInputDigest: createHash("sha256").update(JSON.stringify(packet)).digest("hex"),
        missingFields: [], personalActs: [{ id: "signature", title: "Required signature", explanation: "Required before an actual submission." }],
      }));
      const result = await runSupportService(input);
      expect(input.ports.fillForm).toHaveBeenCalledWith("snap-pa", { zip: "19104" }, "snap_new");
      expect(input.ports.prepareOperation).toHaveBeenCalledOnce();
      expect(vi.mocked(input.ports.prepareOperation).mock.calls[0][0]).toMatchObject({
        action: "prepare", programId: "snap-pa", need: "snap_new", packet: { zip: "19104" },
        dataCategories: ["household"], documentIds: [], form: { artifactId: "owned-prepared-artifact" },
      });
      expect(input.ports.execute).not.toHaveBeenCalled();
      expect(input.ports.personalActsComplete).not.toHaveBeenCalled();
      expect(result.requiredActions.filter(action => action.resolver === "parent")).toEqual([]);
      expect(result.plan.routes[0].state).toBe("prepared");
      expect(result.nextRunAt).toBeNull();
      expect(result.nextTrigger).toBe(mode === "full" ? "provider_capability_enabled" : "none");
    },
  );
  it("does not start preparation when that action is outside the mandate", async () => {
    const request = fixtureRequest({ intake: fixtureIntake({ needs: ["snap_new"] }),
      mandate: fixtureMandate({ recipientIds: ["snap-pa"], allowedActions: ["research"] }) });
    const input = setup(request);
    vi.mocked(input.ports.capability).mockResolvedValue(null);
    await runSupportService(input);
    expect(input.ports.fillForm).not.toHaveBeenCalled();
    expect(input.ports.prepareOperation).not.toHaveBeenCalled();
  });
  it("prepares an incomplete form without requesting a booking choice for the superseded action", async () => {
    const request = fixtureRequest({ intake: fixtureIntake({ needs: ["snap_new"] }),
      mandate: fixtureMandate({ recipientIds: ["snap-pa"], allowedActions: ["prepare", "schedule"], bookingPreference: "ask_me" }) });
    const input = setup(request);
    vi.mocked(input.ports.capability).mockImplementation(async (programId, action) =>
      action === "schedule" ? { ...capability(programId), actions: ["schedule"], requiresForm: true, allowedFields: ["zip"] } : null);
    vi.mocked(input.ports.fillForm).mockImplementation(async (programId, packet) => ({
      programId, templateId: "verified-snap-test", version: "1", validated: true, preparationOnly: true,
      artifactId: "owned-prepared-artifact", contentSha256: "a".repeat(64),
      formInputDigest: createHash("sha256").update(JSON.stringify(packet)).digest("hex"), missingFields: [], personalActs: [],
    }));
    const result = await runSupportService(input);
    expect(input.ports.prepareOperation).toHaveBeenCalledOnce();
    expect(vi.mocked(input.ports.prepareOperation).mock.calls[0][0].action).toBe("prepare");
    expect(result.requiredActions.some(action => action.field === "bookingPreference")).toBe(false);
    expect(input.ports.execute).not.toHaveBeenCalled();
  });
  it("keeps an unsupported required form detail service-owned during preparation", async () => {
    const request = fixtureRequest({ intake: fixtureIntake({ needs: ["snap_new"] }),
      mandate: fixtureMandate({ mode: "prepare_only", recipientIds: ["snap-pa"], allowedActions: ["prepare"] }) });
    const input = setup(request);
    vi.mocked(input.ports.capability).mockImplementation(async (programId, action) =>
      action === "prepare" ? { ...capability(programId), actions: ["prepare"], requiresForm: true, allowedFields: ["zip"] } : null);
    vi.mocked(input.ports.fillForm).mockResolvedValue({ programId: "snap-pa", templateId: "test", version: "1", validated: true,
      formInputDigest: createHash("sha256").update(JSON.stringify({ zip: "19104" })).digest("hex"),
      missingFields: ["unsupported-applicant-field"], personalActs: [] });
    const result = await runSupportService(input);
    expect(input.ports.prepareOperation).not.toHaveBeenCalled();
    expect(result.requiredActions).toEqual([expect.objectContaining({ reason: "execution_issue", resolver: "operator" })]);
    expect(result.plan.routes[0].nextActor).toBe("caselink");
  });
  it.each(["needs_current_facts", "service_blocked", "ready"] as const)("uses private SNAP %s metadata without generic answers or execution", async state => {
    const request = fixtureRequest({ intake: fixtureIntake({ needs: ["snap_new"] }),
      mandate: fixtureMandate({ mode: "prepare_only", recipientIds: ["snap-pa"], allowedActions: ["research", "prepare"] }) });
    const input = setup(request);
    vi.mocked(input.ports.capability).mockImplementation(async (programId, action) => action === "prepare"
      ? { ...capability(programId), actions: ["prepare"], requiresForm: true, allowedFields: ["zip"] } : null);
    let binding = "a".repeat(64);
    vi.mocked(input.ports.fillForm).mockImplementation(async (programId, packet) => ({
      programId, templateId: "private-snap-preview", version: "1", validated: true, preparationOnly: true,
      formInputDigest: createHash("sha256").update(JSON.stringify(packet)).digest("hex"), personalActs: [],
      missingFields: state === "needs_current_facts" ? ["snap_application_details"] : [],
      ...(state === "ready" ? { artifactId: "artifact", contentSha256: "c".repeat(64) } : {}),
      snapApplication: { snapshotId: "11111111-1111-4111-8111-111111111111", snapshotHash: binding, state,
        missingFields: [], invalidCurrentFields: [], staleFields: [], serviceQuestions: [], renderingRequirements: state === "service_blocked" ? ["field_layout_or_font_support"] : [], dataCategories: ["household", "income"] },
    }));
    const result = await runSupportService(input);
    expect(input.ports.execute).not.toHaveBeenCalled();
    if (state === "needs_current_facts") {
      expect(input.ports.prepareOperation).not.toHaveBeenCalled();
      expect(result.requiredActions).toEqual([expect.objectContaining({ field: "snap_application_details", resolver: "parent", reason: "missing_fact" })]);
    } else if (state === "service_blocked") {
      expect(input.ports.prepareOperation).not.toHaveBeenCalled();
      expect(result.requiredActions).toEqual([expect.objectContaining({ reason: "execution_issue", resolver: "operator" })]);
    } else {
      const operation = vi.mocked(input.ports.prepareOperation).mock.calls[0][0];
      expect(operation.packet).toEqual({}); expect(operation.dataCategories).toEqual(["household", "income"]);
      binding = "b".repeat(64); await runSupportService(input);
      expect(vi.mocked(input.ports.prepareOperation).mock.calls[1][0].idempotencyKey).not.toBe(operation.idempotencyKey);
    }
  });
  it("asks only for actual required personal acts, continues food, and resumes after verified completion", async () => {
    const request = fixtureRequest();
    const input = setup(request);
    vi.mocked(input.ports.capability).mockImplementation(async (programId) => ({
      ...capability(programId),
      personalActsComplete: programId !== "peco-cap",
      requiredPersonalActs: [
        {
          id: "identity",
          title: "Verify with PECO",
          explanation: "This program requires your identity check.",
        },
        {
          id: "declaration",
          title: "Make the required declaration",
          explanation: "Only you may make this declaration.",
        },
      ],
    }));
    const first = await runSupportService(input);
    expect(
      first.plan.routes.find((route) => route.need === "food_now")?.state,
    ).toBe("sent");
    expect(
      first.requiredActions.filter(
        (action) => action.reason === "personal_step",
      ),
    ).toHaveLength(2);
    expect(
      vi
        .mocked(input.ports.execute)
        .mock.calls.some((call) => call[0].programId === "peco-cap"),
    ).toBe(false);
    const resumed = setup(singleUtilityRequest());
    const second = await runSupportService(resumed);
    expect(second.plan.routes[0].state).toBe("sent");
  });
  it("shows every required personal act once with form-specific wording, then resumes the exact prepared work", async () => {
    const input = setup();
    vi.mocked(input.ports.capability).mockImplementation(async (programId) => ({
      ...capability(programId),
      personalActsComplete: programId !== "peco-cap",
      requiresForm: programId === "peco-cap",
      requiredPersonalActs: [
        {
          id: "declaration",
          title: "Generic declaration",
          explanation: "Generic declaration instructions.",
        },
        {
          id: "identity",
          title: "Required provider identity step",
          explanation: "This synthetic verified route requires an identity step.",
        },
      ],
    }));
    vi.mocked(input.ports.fillForm).mockImplementation(async (programId, packet) =>
      programId === "peco-cap" ? {
        programId,
        templateId: "synthetic-template",
        version: "1",
        artifactId: "synthetic-artifact",
        contentSha256: "a".repeat(64),
        formInputDigest: createHash("sha256")
          .update(JSON.stringify(packet))
          .digest("hex"),
        validated: true,
        missingFields: [],
        personalActs: [{
          id: "declaration",
          title: "Required form declaration",
          explanation: "The exact form's declaration and disclosure scope.",
        }],
      } : null,
    );
    const first = await runSupportService(input);
    const acts = first.requiredActions.filter(
      (action) => action.reason === "personal_step",
    );
    expect(acts.map((action) => action.title)).toEqual([
      "Required form declaration",
      "Required provider identity step",
    ]);
    expect(acts[0].explanation).toBe("The exact form's declaration and disclosure scope.");
    expect(acts.every((action) => action.resolver === "parent")).toBe(true);
    expect(first.plan.routes.find((route) => route.need === "food_now")?.state).toBe("sent");
    expect(vi.mocked(input.ports.execute).mock.calls.some(
      ([operation]) => operation.programId === "peco-cap",
    )).toBe(false);
    const prepared = vi.mocked(input.ports.prepareOperation).mock.calls[0][0];
    vi.mocked(input.ports.personalActsComplete).mockImplementation(async (operation) =>
      JSON.stringify(operation) === JSON.stringify(prepared),
    );
    const resumed = await runSupportService(input);
    const sent = vi.mocked(input.ports.execute).mock.calls.find(
      ([operation]) => operation.programId === "peco-cap",
    )?.[0];
    expect(sent).toEqual(prepared);
    expect(resumed.requiredActions.filter(
      (action) => action.reason === "personal_step",
    )).toEqual([]);
  });
  it("runs due follow-up against the exact recorded reference and advances to received support", async () => {
    const request = singleUtilityRequest();
    request.plan = buildSupportPlan(request, fixtureNow);
    request.plan.routes[0].state = "sent";
    const input = setup(request);
    vi.mocked(input.ports.execute).mockImplementation(async (operation) => {
      const decision = authorizeOperation({
        request,
        operation,
        capability: capability(operation.programId),
        accountActive: true,
        attempts: 1,
        now: fixtureNow,
        revoked: false,
        documentsValid: true,
        statusReferences: ["synthetic-provider-reference"],
      });
      return decision.allowed
        ? { state: "support_received", receipt: receipt("support_received") }
        : { state: "blocked", reason: decision.reason };
    });
    const result = await runSupportService({
      ...input,
      operations: [acknowledged(request)],
    });
    const operation = vi.mocked(input.ports.execute).mock.calls[0][0];
    expect(operation.action).toBe("follow_up");
    expect(operation.packet).toEqual({
      statusReference: "synthetic-provider-reference",
    });
    expect(operation.dataCategories).toEqual(["household"]);
    expect(result.plan.routes[0].state).toBe("support_received");
    expect(result.nextRunAt).toBeNull();
  });
  it("schedules a future internal follow-up instead of polling before its due time", async () => {
    const request = singleUtilityRequest();
    request.plan = buildSupportPlan(request, fixtureNow);
    request.plan.routes[0].state = "agency_submitted";
    const input = setup(request);
    const result = await runSupportService({
      ...input,
      operations: [
        acknowledged(request, "agency_submitted", fixtureNow.toISOString()),
      ],
    });
    expect(input.ports.execute).not.toHaveBeenCalled();
    expect(result.nextRunAt).toBe("2026-10-25T17:00:00.000Z");
  });
  it("does not regress an approval when a later channel acknowledgement is less specific", async () => {
    const request = singleUtilityRequest();
    request.plan = buildSupportPlan(request, fixtureNow);
    request.plan.routes[0].state = "assistance_approved";
    const input = setup(request);
    vi.mocked(input.ports.execute).mockResolvedValue({
      state: "sent",
      receipt: receipt("sent"),
    });
    const result = await runSupportService({
      ...input,
      operations: [acknowledged(request, "assistance_approved")],
    });
    expect(result.plan.routes[0].state).toBe("assistance_approved");
  });
  it("requires a known form when the actual route requires one and rejects mismatched generated bytes", async () => {
    const input = setup(singleUtilityRequest());
    vi.mocked(input.ports.capability).mockImplementation(async (programId) => ({
      ...capability(programId),
      requiresForm: true,
    }));
    await runSupportService(input);
    expect(input.ports.execute).not.toHaveBeenCalled();
    vi.mocked(input.ports.fillForm).mockResolvedValue({
      programId: "peco-cap",
      templateId: "synthetic-template",
      version: "1",
      artifactId: "synthetic-artifact",
      contentSha256: "a".repeat(64),
      formInputDigest: "b".repeat(64),
      validated: true,
      missingFields: [],
      personalActs: [],
    });
    await runSupportService(input);
    expect(input.ports.execute).not.toHaveBeenCalled();
  });
  it("binds a validated known form to the exact input and keeps metadata outside provider fields", async () => {
    const input = setup(singleUtilityRequest());
    vi.mocked(input.ports.fillForm).mockImplementation(
      async (programId, packet) => ({
        programId,
        templateId: "synthetic-template",
        version: "1",
        artifactId: "synthetic-artifact",
        contentSha256: "a".repeat(64),
        formInputDigest: createHash("sha256")
          .update(JSON.stringify(packet))
          .digest("hex"),
        validated: true,
        missingFields: [],
        personalActs: [],
      }),
    );
    const result = await runSupportService(input);
    const operation = vi.mocked(input.ports.execute).mock.calls[0][0];
    expect(operation.form?.artifactId).toBe("synthetic-artifact");
    expect(operation.packet.form).toBeUndefined();
    expect(result.plan.routes[0].state).toBe("sent");
  });
  it("keeps recorded outcomes intact if queuing a notification fails", async () => {
    const input = setup();
    vi.mocked(input.ports.notify).mockRejectedValue(
      new Error("Outbox unavailable"),
    );
    const result = await runSupportService(input);
    expect(result.plan.routes.map((route) => route.state)).toEqual([
      "sent",
      "sent",
    ]);
    expect(result.events).toHaveLength(2);
  });
});

describe("operation identity and correction recovery", () => {
  it("keeps a known submitted journey after correction clears the current plan", async () => {
    const request = singleUtilityRequest();
    request.version = 2;
    request.plan = null;
    const input = setup(request);
    const result = await runSupportService({
      ...input,
      operations: [acknowledged(request, "agency_submitted")],
    });
    expect(vi.mocked(input.ports.execute).mock.calls[0][0].action).toBe(
      "follow_up",
    );
    expect(result.plan.routes[0].state).toBe("agency_submitted");
  });
  it("uses different recipient-bound keys for an authorized alternative with the same facts", async () => {
    const request = singleUtilityRequest();
    request.mandate.recipientIds.push("uesf-utilities");
    const first = setup(request);
    vi.mocked(first.ports.coordinate).mockResolvedValue({
      plan: buildSupportPlan(request, fixtureNow, {
        electricity: "peco-cap",
      }),
      requiredActions: [],
      modelCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
    await runSupportService(first);
    const original = vi.mocked(first.ports.execute).mock.calls[0][0];
    const second = setup(request);
    await runSupportService({
      ...second,
      operations: [acknowledged(request, "declined")],
    });
    const alternative = vi.mocked(second.ports.execute).mock.calls[0][0];
    expect(original.packet).toEqual(alternative.packet);
    expect(original.programId).toBe("peco-cap");
    expect(alternative.programId).toBe("uesf-utilities");
    expect(original.idempotencyKey).not.toBe(alternative.idempotencyKey);
  });
  it("gives a new due follow-up a new identity while retries of one cycle stay stable", async () => {
    const request = singleUtilityRequest();
    request.plan = buildSupportPlan(request, fixtureNow);
    request.plan.routes[0].state = "sent";
    const first = setup(request);
    await runSupportService({ ...first, operations: [acknowledged(request)] });
    const firstKey = vi.mocked(first.ports.execute).mock.calls[0][0]
      .idempotencyKey;
    const previousCheck: ServiceOperation = {
      ...acknowledged(request, "agency_submitted", fixtureNow.toISOString()),
      id: "prior-status-check",
      action: "follow_up",
    };
    const second = setup(request);
    const nextInput = {
      ...second,
      operations: [acknowledged(request), previousCheck],
      now: new Date("2026-10-25T18:00:00Z"),
    };
    await runSupportService(nextInput);
    await runSupportService(nextInput);
    const keys = vi
      .mocked(second.ports.execute)
      .mock.calls.map((call) => call[0].idempotencyKey);
    expect(keys[0]).not.toBe(firstKey);
    expect(keys[0]).toBe(keys[1]);
  });
  it("does not submit through an alternative while another recipient’s delivery for the need is unknown", async () => {
    const request = singleUtilityRequest();
    request.mandate.recipientIds = ["uesf-utilities", "peco-cap"];
    const input = setup(request);
    const previous = {
      ...acknowledged(request),
      state: "delivery_unknown" as const,
      receipt: undefined,
    };
    await runSupportService({ ...input, unknownOperations: [previous] });
    expect(input.ports.execute).not.toHaveBeenCalled();
    expect(input.ports.reconcile).toHaveBeenCalledWith(previous);
  });
});

describe("complete history and raw-document cleanup", () => {
  it("does not try either previously declined recipient again", async () => {
    const request = singleUtilityRequest();
    request.mandate.recipientIds.push("uesf-utilities");
    const input = setup(request);
    const second = {
      ...acknowledged(request, "declined", "2026-10-25T15:00:00Z"),
      id: "other-decline",
      programId: "uesf-utilities",
    };
    const result = await runSupportService({
      ...input,
      operations: [acknowledged(request, "declined"), second],
    });
    expect(input.ports.execute).not.toHaveBeenCalled();
    expect(result.plan.routes[0].state).toBe("unresolved");
    expect(result.nextTrigger).toBe("route_review_required");
  });
  it("does not erase received support when another recipient later declines", async () => {
    const request = singleUtilityRequest();
    request.mandate.recipientIds.push("uesf-utilities");
    const input = setup(request);
    const later = {
      ...acknowledged(request, "declined", "2026-10-25T15:00:00Z"),
      id: "other-decline",
      programId: "uesf-utilities",
    };
    const result = await runSupportService({
      ...input,
      operations: [acknowledged(request, "support_received"), later],
    });
    expect(result.plan.routes[0].state).toBe("support_received");
    expect(result.plan.routes[0].programId).toBe("peco-cap");
    expect(input.ports.execute).not.toHaveBeenCalled();
  });
  it("can reuse separately authorized fresh facts after raw cleanup without re-extracting or attaching the missing original", async () => {
    const input = setup(singleUtilityRequest());
    input.documents = [
      document(input.request.id, {
        status: "raw_deleted",
        expires_at: "2026-10-24T00:00:00Z",
        facts,
        validatedAt: fixtureNow.toISOString(),
        factsExpiresAt: "2026-10-26T00:00:00Z",
      }),
    ];
    const result = await runSupportService(input);
    const operation = vi.mocked(input.ports.execute).mock.calls[0][0];
    expect(input.ports.extractDocument).not.toHaveBeenCalled();
    expect(operation.packet.amountDue).toBe(50);
    expect(operation.documentIds).toEqual([]);
    expect(result.plan.routes[0].state).toBe("sent");
  });
});
