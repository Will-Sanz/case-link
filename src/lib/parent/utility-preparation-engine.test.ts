import { describe, expect, it, vi } from "vitest";
import { authorizeOperation, type ProposedOperation, type ProviderCapability } from "./policy";
import { executeSupportOperation } from "./execution";
import { applicationReadiness, supportRouteLabel } from "./application-readiness";
import { runSupportService, type ServicePorts, type ServiceOperation } from "./service";
import { buildSupportPlan } from "./planning";
import { fixtureIntake, fixtureMandate, fixtureNow, fixtureRequest } from "./test-fixtures";
import { fixtureUtilityProtectedOperation } from "./utility-preparation-test-fixtures";

function setup() {
  const canonical = fixtureUtilityProtectedOperation();
  canonical.packet.protectedUtilityPacket.preparedAt = fixtureNow.toISOString();
  canonical.packet.protectedUtilityPacket.expiresAt = new Date(fixtureNow.getTime()+300000).toISOString();
  const request = fixtureRequest({ id: canonical.requestId, version: canonical.requestVersion, has_water_application_details: true,
    intake: fixtureIntake({ needs: ["water"], utilityProviders: ["pwd"], incomeAmount: null, householdSize: null }),
    mandate: fixtureMandate({ mode: "prepare_only", recipientIds: ["pwd-tap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility", "documents"] }) });
  const operation: ProposedOperation = { need: canonical.need, requestVersion: canonical.requestVersion, programId: canonical.programId, action: "prepare",
    dataCategories: canonical.dataCategories, documentIds: [], packet: canonical.packet, idempotencyKey: canonical.idempotencyKey, protectedUtility: canonical };
  const capability: ProviderCapability = { programId: "pwd-tap", enabled: false, actions: [], permissionReference: null, permissionExpiresAt: null, personalActsComplete: false, dataCategories: [] };
  return { request, operation, capability, accountActive: true, revoked: false, now: fixtureNow, documentsValid: false, attempts: 0, canonical };
}

describe("utility preparation in the shared engine", () => {
  it("permits only the current unsigned private preparation without inventing provider permission or personal acts", () => {
    expect(authorizeOperation(setup())).toEqual({ allowed: true });
  });
  it.each(["currentness", "expiry", "future", "version", "scope", "raw", "unbound", "key", "categories", "recipient", "paused", "account"])("blocks changed %s before adopting a private draft", kind => {
    const input = setup();
    if (kind === "currentness") input.canonical.protectedPacketCurrent = false;
    if (kind === "expiry") input.canonical.packet.protectedUtilityPacket.expiresAt = fixtureNow.toISOString();
    if (kind === "future") input.canonical.packet.protectedUtilityPacket.preparedAt = new Date(fixtureNow.getTime()+1000).toISOString();
    if (kind === "version") input.operation.requestVersion++;
    if (kind === "scope") input.request.mandate.mode = "full";
    if (kind === "raw") input.operation.packet = { ...input.operation.packet, accessCode: "PRIVATE_CANARY" };
    if (kind === "unbound") delete input.operation.protectedUtility;
    if (kind === "key") input.operation.idempotencyKey += "-different";
    if (kind === "categories") input.operation.dataCategories = ["household", "utility"];
    if (kind === "recipient") input.request.mandate.recipientIds = ["peco-cap"];
    if (kind === "paused") input.request.status = "paused";
    if (kind === "account") input.accountActive = false;
    expect(authorizeOperation(input).allowed).toBe(false);
  });
  it.each(["prepare", "submit", "follow_up"] as const)("never delivers a protected utility draft even if a transport exists for %s", async action => {
    const input = setup(); input.operation.action = action;
    const store = { prepare: vi.fn(), begin: vi.fn(), finish: vi.fn() }, transport = { execute: vi.fn() };
    expect(await executeSupportOperation({ ...input, store, transport, readiness: { requiredFields: [], formVerified: true } })).toEqual({ state: "blocked", reason: "utility_preparation_only" });
    expect(store.prepare).not.toHaveBeenCalled(); expect(store.begin).not.toHaveBeenCalled(); expect(transport.execute).not.toHaveBeenCalled();
    const readiness = applicationReadiness({ authority: input, requiredFields: [], formVerified: true, transportReady: true });
    expect(readiness.automaticHandlingAllowed).toBe(false);
    expect(readiness.blockers).toContainEqual(expect.objectContaining({ id: "utility-preparation-only", owner: "caselink" }));
  });
  function serviceSetup() {
    const input = setup();
    const ports: ServicePorts = { coordinate: vi.fn(async request => ({ plan: buildSupportPlan(request, fixtureNow), requiredActions: [], modelCalls: 0, inputTokens: 0, outputTokens: 0 })),
      extractDocument: vi.fn(), saveDocumentFacts: vi.fn(), capability: vi.fn(), execute: vi.fn(), prepareOperation: vi.fn(), personalActsComplete: vi.fn(), reconcile: vi.fn(), fillForm: vi.fn(), notify: vi.fn() };
    const previous: ServiceOperation = { id: input.canonical.operationId, need: "water", programId: "pwd-tap", action: "prepare", state: "prepared",
      packet: input.canonical.packet, protectedUtility: input.canonical, idempotencyKey: input.canonical.idempotencyKey, updatedAt: fixtureNow.toISOString() };
    return { ...input, ports, operations: [previous], documents: [], utilityPreparation: { programId: "pwd-tap" as const, state: "prepared" as const } };
  }
  it("records actual local-test preparation without generic income questions, repeated approval, ordinary files or receipts", async () => {
    const input = serviceSetup(), result = await runSupportService(input);
    expect(result.plan.routes[0]).toMatchObject({ state: "prepared", nextActor: "caselink", limitation: expect.stringContaining("CaseLink LOCAL TEST") });
    expect(result.requiredActions).toEqual([]);
    expect(input.ports.prepareOperation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ protectedUtility: input.canonical, documentIds: [] }));
    expect(input.ports.fillForm).not.toHaveBeenCalled(); expect(input.ports.extractDocument).not.toHaveBeenCalled(); expect(input.ports.execute).not.toHaveBeenCalled(); expect(input.ports.capability).not.toHaveBeenCalled();
    expect(JSON.stringify(result.events)).not.toMatch(/agency_submitted|partner_received|support_received|PRIVATE_/);
  });
  it.each(["ambiguous", "unbound", "expired", "wrong_owner"])("keeps %s preparation with CaseLink without provider execution or parent reapproval", async kind => {
    const input = serviceSetup();
    if (kind === "ambiguous") input.operations.push({ ...input.operations[0], id: "99999999-9999-4999-8999-999999999999" });
    if (kind === "unbound") delete input.operations[0].protectedUtility;
    if (kind === "expired") input.canonical.packet.protectedUtilityPacket.expiresAt = fixtureNow.toISOString();
    if (kind === "wrong_owner") input.canonical.requestId = "99999999-9999-4999-8999-999999999999";
    const result = await runSupportService(input);
    expect(result.plan.routes[0].state).toBe("checking");
    expect(result.requiredActions).toContainEqual(expect.objectContaining({ reason: "execution_issue", resolver: "operator" }));
    expect(input.ports.prepareOperation).not.toHaveBeenCalled(); expect(input.ports.execute).not.toHaveBeenCalled(); expect(input.ports.fillForm).not.toHaveBeenCalled();
    expect(result.requiredActions.some(action => action.reason === "expanded_permission")).toBe(false);
  });
  it("labels a checked utility reference as an unsigned private draft and never a completed application or City receipt", () => {
    const input = setup(), route = buildSupportPlan(input.request, fixtureNow).routes[0];
    const recorded = { need: "water" as const, programId: "pwd-tap", action: "prepare", state: "prepared", artifactId: null, protectedPacket: input.canonical.packet.protectedUtilityPacket };
    expect(supportRouteLabel(route, [recorded])).toBe("Unsigned private draft prepared");
    expect(supportRouteLabel(route, [{ ...recorded, action: "submit" }])).not.toBe("Unsigned private draft prepared");
    expect(supportRouteLabel(route, [{ ...recorded, protectedPacket: { raw: "PRIVATE_CANARY" } }])).not.toBe("Unsigned private draft prepared");
  });
});
