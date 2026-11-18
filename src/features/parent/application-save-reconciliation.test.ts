import { describe, expect, it } from "vitest";
import { applicationSaveConfirmed } from "./application-save-reconciliation";

const record = () => ({ request_id: "request", base_version: 2, request_version: 3, idempotency_key: "key", notice_version: "notice",
  details: { customer: { id: "person", name: "Fictional" }, household: [{ id: "child", income: null }] },
  consent_evidence: { subjectAuthorityDeclared: true as const, accountAuthorityDeclared: true as const } });
const attempt = () => ({ key: "key", body: JSON.stringify({ expectedVersion: 2, noticeVersion: "notice", details: record().details,
  subjectAuthorityDeclared: true, accountAuthorityDeclared: true }) });
describe("exact saved application acknowledgement from the latest owned GET", () => {
  it("confirms only the exact write, including after a later routing-only request update", () => {
    expect(applicationSaveConfirmed(attempt(), record(), "request", 3)).toBe(true);
    expect(applicationSaveConfirmed(attempt(), record(), "request", 4)).toBe(true);
    // A no-change save still records a new immutable revision without requeueing the request.
    expect(applicationSaveConfirmed(attempt(), { ...record(), request_version: 2 }, "request", 2)).toBe(true);
    const saved = record(); saved.details.customer = { name: "Fictional", id: "person" };
    expect(applicationSaveConfirmed(attempt(), saved, "request", 3)).toBe(true);
  });
  it.each(["request_id", "base_version", "request_version", "idempotency_key", "notice_version", "details", "consent_evidence"] as const)("preserves a draft when the returned %s differs", field => {
    const saved = record(); Object.assign(saved, { [field]: field === "base_version" ? 1 : field === "request_version" ? 4 : field === "details" ? {} : field === "consent_evidence" ? {} : "other" });
    expect(applicationSaveConfirmed(attempt(), saved, "request", 3)).toBe(false);
  });
  it("does not acknowledge an invalid version, absent write, malformed body or unknown write fields", () => {
    expect(applicationSaveConfirmed(attempt(), { ...record(), request_version: 1 }, "request", 3)).toBe(false);
    expect(applicationSaveConfirmed(null, record(), "request", 3)).toBe(false);
    expect(applicationSaveConfirmed(attempt(), null, "request", 3)).toBe(false);
    expect(applicationSaveConfirmed({ key: "key", body: "{" }, record(), "request", 3)).toBe(false);
    expect(applicationSaveConfirmed({ ...attempt(), body: JSON.stringify({ ...JSON.parse(attempt().body), extra: true }) }, record(), "request", 3)).toBe(false);
  });
  it("checks exact SNAP stale-answer reaffirmations as well as values and stable person order", () => {
    const saved = { ...record(), consent_evidence: undefined, confirmed_paths: ["address.street"] };
    const write = { key: "key", body: JSON.stringify({ expectedVersion: 2, noticeVersion: "notice", details: saved.details, confirmedPaths: ["address.street"] }) };
    expect(applicationSaveConfirmed(write, saved, "request", 3)).toBe(true);
    expect(applicationSaveConfirmed(write, { ...saved, confirmed_paths: [] }, "request", 3)).toBe(false);
    expect(applicationSaveConfirmed(write, { ...saved, details: { ...saved.details, household: [] } }, "request", 3)).toBe(false);
  });
});
