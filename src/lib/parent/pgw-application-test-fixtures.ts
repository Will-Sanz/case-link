import type { PgwApplicationFields } from "./pgw-application-fields";

/** Fictional offline fixtures only; never an account, identity proof or application. */
export function fictionalPgwFields(): PgwApplicationFields {
  return { journey: "new_enrollment", currentCrpState: "not_enrolled", householdComplete: true, accountNumber: "9000000002",
    customer: { id: "11111111-1111-4111-8111-111111111111", firstName: "Fictional", lastName: "Rivera", under18: false,
      income: { state: "sources", sources: [{ id: "33333333-3333-4333-8333-333333333333", kind: "employment" }] } },
    address: { street: "123 Synthetic Way", city: "Philadelphia", state: "PA", zip: "19104" }, phone: "215-555-0101",
    householdMembers: [{ id: "22222222-2222-4222-8222-222222222222", firstName: "FictionalChild", lastName: "Rivera", dateOfBirth: "2020-01-01", relationship: "Child", income: { state: "none", sources: [] } }],
    outsideSupport: { receives: false }, zeroIncomePast30Days: false, snap: { receives: true, monthlyAmountCents: 30000 }, housingSubsidy: { receives: false } };
}
