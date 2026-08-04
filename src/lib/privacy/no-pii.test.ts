import { describe, expect, it } from "vitest";
import {
  findLikelyIdentifiers,
  validateNoPii,
} from "@/lib/privacy/no-pii";

describe("findLikelyIdentifiers", () => {
  it("flags common direct identifiers with the exact matching text", () => {
    const text = [
      "Student ID: AB-4921",
      "DOB 08/14/2012",
      "Call 215-555-0184 or email jane@example.org",
      "Lives at 1234 Market Street",
    ].join(". ");
    const findings = findLikelyIdentifiers(text);
    expect(findings.map((finding) => finding.value)).toEqual([
      "Student ID: AB-4921",
      "DOB 08/14/2012",
      "215-555-0184",
      "jane@example.org",
      "1234 Market Street",
    ]);
  });

  it("flags a likely real name in a case label", () => {
    expect(findLikelyIdentifiers("Jordan Williams", "label")).toMatchObject([
      { kind: "person_name", value: "Jordan Williams" },
    ]);
    expect(findLikelyIdentifiers("Jordan Williams needs housing support.")).toMatchObject([
      { kind: "person_name", value: "Jordan Williams" },
    ]);
  });

  it("allows non-identifying labels and ordinary service-plan language", () => {
    expect(findLikelyIdentifiers("Family 014", "label")).toEqual([]);
    expect(
      findLikelyIdentifiers(
        "Housing Stability is the current goal. Call the Community Outreach Team by 2026-08-10.",
      ),
    ).toEqual([]);
    expect(
      findLikelyIdentifiers("Contact the PECO Customer Assistance Program for an intake."),
    ).toEqual([]);
  });

  it("reports the field and exact text in a correction message", () => {
    const result = validateNoPii([
      { field: "name", label: "Family label", value: "Jordan Williams", mode: "label" },
      { field: "summary", label: "Short description", value: "Call 215-555-0184" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Family label");
    expect(result.error).toContain("Jordan Williams");
    expect(result.error).toContain("215-555-0184");
  });
});
