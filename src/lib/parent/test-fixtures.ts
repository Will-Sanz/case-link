import type { ServiceMandate, SupportIntake, SupportRequest } from "./domain";
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
