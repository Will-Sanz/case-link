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
  };
}
function setup(request = fixtureRequest()) {
  const ports: ServicePorts = {
    coordinate: vi.fn(async (intake, mandate) => ({
      plan: buildSupportPlan(intake, mandate, fixtureNow),
      requiredActions: requiredActions(intake, mandate),
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
    preparePersonalStep: vi.fn(async () => {}),
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

describe("parent service orchestration", () => {
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
    const prepared = vi.mocked(input.ports.preparePersonalStep).mock.calls[0][0];
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
    request.plan = buildSupportPlan(
      request.intake,
      request.mandate,
      fixtureNow,
    );
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
    request.plan = buildSupportPlan(
      request.intake,
      request.mandate,
      fixtureNow,
    );
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
    request.plan = buildSupportPlan(
      request.intake,
      request.mandate,
      fixtureNow,
    );
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
      plan: buildSupportPlan(request.intake, request.mandate, fixtureNow, {
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
    request.plan = buildSupportPlan(
      request.intake,
      request.mandate,
      fixtureNow,
    );
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
