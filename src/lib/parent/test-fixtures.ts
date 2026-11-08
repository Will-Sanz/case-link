import type { ServiceMandate, SupportIntake, SupportRequest } from "./domain";
import { SNAP_APPLICATION_SOURCE, type SnapApplicationFields } from "./snap-application-fields";
import { snapApplicationLeaves } from "./snap-application-snapshot";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import type { SnapProtectedOperation } from "./snap-protected-operation";
import type { SnapFinalizerIntent } from "./snap-packet-contract";

export function fixtureSnapCaptureIntent(): SnapFinalizerIntent {
  const operation = fixtureProtectedSnapOperation(), ref = operation.packet.protectedSnapPacket;
  return { format: "caselink-snap-final-packet-v1", packetId: ref.packetId, ownerId: "22222222-2222-4222-8222-222222222222",
    requestId: operation.requestId, requestVersion: operation.requestVersion, recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet",
    authorizationId: ref.authorizationId, policyVersion: "synthetic-policy-1", retentionPolicyVersion: "synthetic-retention-1",
    templateId: SNAP_APPLICATION_SOURCE.templateId, templateVersion: SNAP_APPLICATION_SOURCE.templateVersion, templateSha256: SNAP_APPLICATION_SOURCE.templateSha256,
    snapshotId: ref.snapshotId, snapshotHash: ref.snapshotHash, contentSha256: ref.contentSha256, byteLength: ref.byteLength };
}

/** Synthetic trusted metadata only; this fixture does not establish PDF correctness, signatures or filing. */
export function fixtureProtectedSnapOperation(overrides: Partial<SnapProtectedOperation> = {}): SnapProtectedOperation {
  const packetId = "77777777-7777-4777-8777-777777777777";
  return {
    operationId: "467931e4-f88c-479b-8dcf-13f8ac397051", requestId: "d430cc02-d8d4-46cc-9900-5b397758fb16", requestVersion: 1,
    need: "snap_new", programId: "snap-pa", action: "submit", state: "prepared",
    packet: { protectedSnapPacket: { packetId, authorizationId: "88888888-8888-4888-8888-888888888888", snapshotId: "99999999-9999-4999-8999-999999999999",
      snapshotHash: "a".repeat(64), contentSha256: "b".repeat(64), byteLength: 1000, verificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
    packetHash: "c".repeat(64), dataCategories: ["household", "income"], documentIds: [], artifactId: null,
    idempotencyKey: `snap-final:${packetId}`, permissionVersion: "synthetic-permission", protectedPacketCurrent: true,
    protectedParentSubmitReady: true,
    personalActsComplete: false, snapSubmissionAuthorized: false, ...overrides,
  };
}

export function fixtureSnapApplication(now = new Date("2026-11-03T21:00:00Z")): SnapApplicationFields {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  return { zip: "19104", language: "en", householdSize: 1,
    applicant: { firstName: "Private Canary", lastName: "Fixture" }, address: { street: "1 Synthetic Street", city: "Philadelphia", state: "PA" },
    county: "Philadelphia", interpreter: false, screening: { lowCashAndIncome: false, migrantOrSeasonal: false, belowShelterCosts: false },
    household: [{ id: "11111111-1111-4111-8111-111111111111", firstName: "Private Canary", lastName: "Fixture", dateOfBirth: "1990-01-01", sex: "female", student: false, relationship: "SELF", requestingSnap: true, citizen: true }],
    income: { month: day.slice(0, 7), hasIncome: false },
    history: { fleeingOrProbation: { answer: false }, welfareFraud: { answer: false }, otherStateDisqualification: { answer: false } },
    expenseClaims: { household: "do_not_claim", medical: "not_applicable" } };
}
export function fixtureSnapSnapshot(now = new Date("2026-11-03T21:00:00Z"), details = fixtureSnapApplication(now)) {
  const confirmedAt = new Date(now.getTime() - 1000).toISOString(), asOf = confirmedAt.slice(0, 10);
  return { id: "22222222-2222-4222-8222-222222222222", request_id: "d430cc02-d8d4-46cc-9900-5b397758fb16",
    revision: 1, base_version: 1, request_version: 2, details, source: SNAP_APPLICATION_SOURCE,
    notice_version: SNAP_APPLICATION_NOTICE_VERSION, idempotency_key: "33333333-3333-4333-8333-333333333333", created_at: now.toISOString(),
    provenance: Object.fromEntries(Object.keys(snapApplicationLeaves(details)).map(path => [path, {
      source: "parent", confirmedAt, asOf, ...(path.startsWith("income.") ? { period: details.income?.month } : {}),
    }])) };
}
export const fixtureNow = new Date("2026-10-25T16:00:00Z");
export function fixtureIntake(
  overrides: Partial<SupportIntake> = {},
): SupportIntake {
  return {
    needs: ["food_now", "electricity"],
    urgency: "today",
    zip: "19104",
    language: "en",
    householdSize: 3,
    childrenUnderFive: null,
    pregnantOrPostpartum: null,
    incomeAmount: null,
    incomeFrequency: "unknown",
    utilityProviders: ["peco"],
    shutoffDate: null,
    accountAuthority: "self",
    contactPreference: "in_app",
    adultConfirmed: true,
    ...overrides,
  };
}
export function fixtureMandate(
  overrides: Partial<ServiceMandate> = {},
): ServiceMandate {
  return {
    version: 1,
    mode: "full",
    recipientIds: ["philly-food", "peco-cap"],
    allowedActions: [
      "research",
      "prepare",
      "share",
      "submit",
      "schedule",
      "follow_up",
    ],
    allowedData: ["household", "income", "utility", "documents"],
    expiresAt: "2026-11-10T16:00:00Z",
    maxAttempts: 12,
    maxRecipients: 8,
    bookingPreference: "weekday_morning",
    accepted: true,
    ...overrides,
  };
}
export function fixtureRequest(
  overrides: Partial<SupportRequest> = {},
): SupportRequest {
  return {
    id: "d430cc02-d8d4-46cc-9900-5b397758fb16",
    household_id: "ea9d3be3-28b6-4142-858b-fcc78712f887",
    status: "active",
    intake: fixtureIntake(),
    mandate: fixtureMandate(),
    plan: null,
    required_actions: [],
    version: 1,
    created_at: fixtureNow.toISOString(),
    updated_at: fixtureNow.toISOString(),
    intake_need_scoped_fields: [],
    ...overrides,
  };
}
