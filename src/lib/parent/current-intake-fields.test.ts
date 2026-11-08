import { describe, expect, it } from "vitest";
import type { SupportRequest } from "./domain";
import { currentIntakeFields } from "./current-intake-fields";
import { fixtureIntake, fixtureMandate, fixtureNow, fixtureRequest } from "./test-fixtures";

const fields = ["zip", "householdSize", "incomeAmount", "incomeFrequency"];
const now = fixtureNow;
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
const dates = (date = now.toISOString()) => Object.fromEntries(fields.map((field) => [field, date]));
const expected = { zip: "19104", householdSize: 3, incomeAmount: 3125, incomeFrequency: "monthly" };

function request(overrides: Record<string, unknown> = {}): SupportRequest {
  return {
    ...fixtureRequest(),
    intake: fixtureIntake({ incomeAmount: 3125, incomeFrequency: "monthly" }),
    intake_confirmed_at: dates(),
    intake_need_scoped_fields: [],
    ...overrides,
  } as SupportRequest;
}

function fact(field: string, value: unknown, overrides: Record<string, unknown> = {}) {
  return {
    need: "electricity",
    field,
    value,
    source: "parent",
    confirmedAt: now.toISOString(),
    asOf: now.toISOString().slice(0, 10),
    ...overrides,
  };
}

describe("current intake fields from dated permitted sources", () => {
  it("reuses fresh unrestricted intake values, including a zero income", () => {
    expect(currentIntakeFields(request(), now)).toEqual(expected);
    expect(currentIntakeFields(request({
      intake: fixtureIntake({ incomeAmount: 0, incomeFrequency: "monthly" }),
    }), now)).toEqual({ ...expected, incomeAmount: 0 });
  });

  it("respects household and income permission independently", () => {
    expect(currentIntakeFields(request({
      mandate: fixtureMandate({ allowedData: ["household"] }),
    }), now)).toEqual({ zip: "19104", householdSize: 3 });
    expect(currentIntakeFields(request({
      mandate: fixtureMandate({ allowedData: ["income"] }),
    }), now)).toEqual({ incomeAmount: 3125, incomeFrequency: "monthly" });
    expect(currentIntakeFields(request({
      mandate: fixtureMandate({ allowedData: ["utility"] }),
    }), now)).toEqual({});
  });

  it("uses the existing 45-day source-age ceiling inclusively", () => {
    expect(currentIntakeFields(request({ intake_confirmed_at: dates(daysAgo(45)) }), now)).toEqual(expected);
    expect(currentIntakeFields(request({
      intake_confirmed_at: dates(new Date(now.getTime() - 45 * 86400000 - 1).toISOString()),
    }), now)).toEqual({});
  });

  it("does not turn reads, renewal or a recent unrelated update into source freshness", () => {
    const old = request({
      created_at: daysAgo(60),
      updated_at: now.toISOString(),
      intake_confirmed_at: dates(daysAgo(60)),
      mandate: fixtureMandate({ expiresAt: new Date(now.getTime() + 86400000).toISOString() }),
    });
    expect(currentIntakeFields(old, now)).toEqual({});
    expect(old).toMatchObject({ intake_confirmed_at: dates(daysAgo(60)) });
    expect(old.intake.incomeAmount).toBe(3125);
  });

  it("falls back to created_at only for absent source keys", () => {
    const partial = request({
      created_at: daysAgo(1),
      updated_at: now.toISOString(),
      intake_confirmed_at: { householdSize: now.toISOString() },
    });
    expect(currentIntakeFields(partial, now)).toEqual(expected);
    expect(currentIntakeFields(request({
      created_at: daysAgo(60), intake_confirmed_at: {},
    }), now)).toEqual({});
  });

  it.each([
    null, "not-a-date", "2026-09-31T16:00:00Z", "October 25, 2026",
    "2026-10-25T16:00:00", 0, {},
    new Date(now.getTime() + 1).toISOString(),
  ])(
    "does not replace an explicitly invalid or future source date with created_at: %j",
    (invalid) => {
      expect(currentIntakeFields(request({
        created_at: now.toISOString(),
        intake_confirmed_at: { ...dates(), zip: invalid },
      }), now)).toEqual({ householdSize: 3, incomeAmount: 3125, incomeFrequency: "monthly" });
    },
  );

  it("accepts a recorded timestamp whose own calendar date differs from its UTC date", () => {
    expect(currentIntakeFields(request({
      intake_confirmed_at: dates("2026-10-24T23:30:00-04:00"),
    }), now)).toEqual(expected);
  });

  it.each([undefined, null, "zip", {}, [null], ["unknown-field"]])(
    "treats missing or invalid restriction metadata conservatively: %j",
    (restrictions) => {
      expect(currentIntakeFields(request({ intake_need_scoped_fields: restrictions }), now)).toEqual({});
    },
  );

  it("omits just restricted fields and keeps income atomic when one component is restricted or stale", () => {
    expect(currentIntakeFields(request({ intake_need_scoped_fields: ["zip"] }), now))
      .toEqual({ householdSize: 3, incomeAmount: 3125, incomeFrequency: "monthly" });
    expect(currentIntakeFields(request({ intake_need_scoped_fields: ["incomeAmount"] }), now))
      .toEqual({ zip: "19104", householdSize: 3 });
    expect(currentIntakeFields(request({
      intake_confirmed_at: { ...dates(), incomeFrequency: daysAgo(46) },
    }), now)).toEqual({ zip: "19104", householdSize: 3 });
  });

  it("does not expose malformed original field values", () => {
    expect(currentIntakeFields(request({
      intake: { ...fixtureIntake(), zip: "invalid", householdSize: -1, incomeAmount: 20, incomeFrequency: "unknown" },
    }), now)).toEqual({});
  });
});

describe("current intake fields from exact-need parent answers", () => {
  it("uses validated exact-need answers despite restricted generic intake", () => {
    const saved = request({
      intake_need_scoped_fields: fields,
      facts: [fact("zip", "19103"), fact("householdSize", 4), fact("income", { amount: 0, frequency: "weekly" })],
    });
    expect(currentIntakeFields(saved, now, "electricity"))
      .toEqual({ zip: "19103", householdSize: 4, incomeAmount: 0, incomeFrequency: "weekly" });
    expect(currentIntakeFields({ ...saved, intake_need_scoped_fields: null } as unknown as SupportRequest, now, "electricity"))
      .toEqual({ zip: "19103", householdSize: 4, incomeAmount: 0, incomeFrequency: "weekly" });
    expect(currentIntakeFields(saved, now)).toEqual({});
    expect(currentIntakeFields(saved, now, "food_now")).toEqual({});
    expect(currentIntakeFields(saved, now, "gas")).toEqual({});
  });

  it("preserves a restriction after its originating need and answer have been removed", () => {
    expect(currentIntakeFields(request({
      intake: fixtureIntake({ needs: ["electricity"], incomeAmount: 4000, incomeFrequency: "weekly" }),
      intake_need_scoped_fields: ["incomeAmount", "incomeFrequency"],
      facts: [],
    }), now, "electricity")).toEqual({ zip: "19104", householdSize: 3 });
  });

  it("cannot restore a field after its category permission is removed", () => {
    const saved = request({
      mandate: fixtureMandate({ allowedData: ["household"] }),
      facts: [fact("income", { amount: 4000, frequency: "weekly" })],
    });
    expect(currentIntakeFields(saved, now, "electricity")).toEqual({ zip: "19104", householdSize: 3 });
  });

  it.each([
    { source: "document" },
    { confirmedAt: "invalid" },
    { confirmedAt: new Date(now.getTime() + 1).toISOString() },
    { asOf: "invalid" },
    { asOf: "2026-10-26" },
    { confirmedAt: daysAgo(46), asOf: daysAgo(46).slice(0, 10) },
    { need: "food_now" },
  ])("ignores out-of-scope, stale or malformed source evidence: %j", (invalid) => {
    expect(currentIntakeFields(request({
      intake_need_scoped_fields: fields,
      facts: [fact("zip", "19103", invalid)],
    }), now, "electricity")).toEqual({});
  });

  it.each([
    null,
    42,
    "invalid",
    {},
    fact("zip", "bad"),
    fact("householdSize", 0),
    fact("income", { amount: -1, frequency: "monthly" }),
    fact("income", { amount: 0, frequency: "unknown" }),
    fact("income", { amount: 10, frequency: "weekly", extra: true }),
  ])("does not use an invalid typed answer: %j", (invalid) => {
    expect(currentIntakeFields(request({
      intake_need_scoped_fields: fields, facts: [invalid],
    }), now, "electricity")).toEqual({});
  });

  it.each([
    ["incomeAmount", 4000],
    ["incomeFrequency", "weekly"],
  ])("does not splice a differing partial %s answer into a baseline income pair", (field, value) => {
    expect(currentIntakeFields(request({ facts: [fact(String(field), value)] }), now, "electricity"))
      .toEqual({ zip: "19104", householdSize: 3 });
  });

  it.each([
    ["incomeAmount", 3125],
    ["incomeFrequency", "monthly"],
  ])("preserves a valid original pair after a same-value partial %s confirmation", (field, value) => {
    expect(currentIntakeFields(request({ facts: [fact(String(field), value)] }), now, "electricity"))
      .toEqual(expected);
  });

  it("does not manufacture a paired fact from separate incomplete legacy components", () => {
    expect(currentIntakeFields(request({
      intake_need_scoped_fields: ["incomeAmount", "incomeFrequency"],
      facts: [fact("incomeAmount", 4000), fact("incomeFrequency", "weekly")],
    }), now, "electricity")).toEqual({ zip: "19104", householdSize: 3 });
  });
  it("orders usable facts before an interleaved invalid timestamp can affect the latest answer", () => {
    const newer = fact("income", { amount: 3125, frequency: "monthly" }, {
      confirmedAt: "2026-10-24T16:00:00Z", asOf: "2026-10-24",
    });
    const invalid = fact("amountDue", 10, { confirmedAt: "invalid" });
    const older = fact("incomeAmount", 4000, {
      confirmedAt: "2026-10-23T16:00:00Z", asOf: "2026-10-23",
    });
    const saved = request({
      intake_need_scoped_fields: ["incomeAmount", "incomeFrequency"],
      facts: [newer, invalid, older],
    });
    expect(currentIntakeFields(saved, now, "electricity")).toEqual(expected);
  });
});
