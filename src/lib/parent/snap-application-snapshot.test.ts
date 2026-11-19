import { describe, expect, it } from "vitest";
import { assessSnapApplicationSnapshot } from "./snap-application-snapshot";
import { fixtureSnapSnapshot } from "./test-fixtures";
const now = new Date("2026-11-03T21:00:00Z");
describe("private SNAP source evidence", () => {
  it("keeps original answers and dates unchanged while assessing current readiness", () => {
    const value = fixtureSnapSnapshot(now), original = structuredClone(value);
    expect(assessSnapApplicationSnapshot(value, now).readiness.nonProtectedDataReadyForReview).toBe(true);
    expect(value).toEqual(original);
  });
  it("does not renew stale original evidence or historical income on an unrelated new authority", () => {
    const value = fixtureSnapSnapshot(now);
    value.provenance["address.street"].confirmedAt = "2026-08-01T12:00:00Z";
    value.provenance["address.street"].asOf = "2026-08-01";
    const result = assessSnapApplicationSnapshot(value, now).readiness;
    expect(result.invalidCurrentFields).toContain("address.street"); expect(result.nonProtectedDataReadyForReview).toBe(false);
    expect(result.staleFields).toEqual(["address.street"]);
  });
  it("does not turn derived count and fixed SELF metadata into parent questions, while real roster facts still age", () => {
    const value = fixtureSnapSnapshot(now), self = value.details.household![0].id;
    for (const path of ["householdSize", `household.${self}.relationship`])
      value.provenance[path] = { source: "parent", confirmedAt: "2026-01-01T12:00:00Z", asOf: "2026-01-01" };
    expect(assessSnapApplicationSnapshot(value, now).readiness.nonProtectedDataReadyForReview).toBe(true);
    value.provenance[`household.${self}.firstName`] = { source: "parent", confirmedAt: "2026-01-01T12:00:00Z", asOf: "2026-01-01" };
    expect(assessSnapApplicationSnapshot(value, now).readiness.staleFields).toEqual([`household.${self}.firstName`]);
    value.details.householdSize = 2;
    expect(assessSnapApplicationSnapshot(value, now).readiness.nonProtectedDataReadyForReview).toBe(false);
  });
  it.each(["missing", "extra", "future", "period", "source"])("rejects malformed %s evidence without making it a family answer", kind => {
    const value = fixtureSnapSnapshot(now);
    if (kind === "missing") delete value.provenance["address.street"];
    if (kind === "extra") value.provenance.unknown = value.provenance["address.street"];
    if (kind === "future") value.provenance["address.street"].confirmedAt = "2026-11-04T12:00:00Z";
    if (kind === "period") value.provenance["income.month"].period = "2026-10";
    if (kind === "source") value.source = { ...value.source, inventorySha256: "a".repeat(64) as typeof value.source.inventorySha256 };
    expect(() => assessSnapApplicationSnapshot(value, now)).toThrow();
  });
  it("does not echo an unknown protected key in a malformed snapshot error", () => {
    expect(() => assessSnapApplicationSnapshot({ ...fixtureSnapSnapshot(now), "123-45-6789": true }, now)).toThrow("snap_snapshot_invalid");
  });
});
