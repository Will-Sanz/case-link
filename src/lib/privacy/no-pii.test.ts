import { describe, expect, it } from "vitest";
import {
  findLikelyIdentifiers,
  validateFamilyNoPii,
  validateNoPii,
} from "@/lib/privacy/no-pii";
import { directoryCase } from "../../../tests/fixtures/directory-case";
import type { PlanWithSteps } from "@/types/family";

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

  it.each(["2155550184", "+12155550184", "(215)555-0184", "(215) 555 0184", "1.215.555.0184"])("flags phone formatting %s", value => {
    expect(findLikelyIdentifiers(`Call ${value} tomorrow.`)).toContainEqual(expect.objectContaining({ kind: "phone", value }));
  });

  it.each(["jordan williams", "María García", "Élodie Durand", "Jordan Williams 014"])("flags likely names in labels: %s", value => {
    expect(findLikelyIdentifiers(value, "label").some(finding => finding.kind === "person_name")).toBe(true);
  });

  it.each(["parent name is jordan williams", "Name: maría garcía", "Student name: Jordan Williams", "DOB: 2012-08-14"])("flags explicit identifying context: %s", value => {
    expect(findLikelyIdentifiers(value).length).toBeGreaterThan(0);
  });

  it.each(["The parent is awaiting confirmation.", "The family is seeking support.", "Phone contact method preferred.", "2026-10-20", "40000000-0000-4000-8000-000000000004"])("allows ordinary context and internal identifiers: %s", value => {
    expect(findLikelyIdentifiers(value)).toEqual([]);
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

describe("saved planning text privacy", () => {
  const paths = [
    "title","description",...['action_needed_now','rationale','detailed_instructions','contact_script','expected_outcome','timing_guidance','stage_goal','why_now','depends_on','milestone_type','success_marker'].map(key=>`details.${key}`),
    ...['checklist','required_documents','materials_needed','blockers','fallback_options'].map(key=>`details.${key}.0`),
    ...['blocker_reason','outcome_notes','contact_attempted_at','outreach_result'].map(key=>`workflow_data.${key}`),
    ...['title','description','notes','outcome'].map(key=>`action_items.0.${key}`),
  ];
  it.each(paths)("detects saved private text in %s", path => {
    const detail = directoryCase();
    const step: Record<string,unknown> = {title:"Intake",description:"Review options",details:{},workflow_data:{},action_items:[{}]};
    const keys = path.split('.'); let current = step;
    for (const key of keys.slice(0,-1)) { current[key] ??= {}; current=current[key] as Record<string,unknown>; }
    current[keys.at(-1)!] = "private-person@example.test";
    detail.plan = {steps:[step]} as unknown as PlanWithSteps;
    const result = validateFamilyNoPii(detail);
    expect(result.ok).toBe(false);
    expect(result.findings[0].field).toBe(`plan.steps.0.${path}`);
  });
  it("allows directory contact values only in the separately sourced contact field", () => {
    const detail = directoryCase();
    detail.plan = {steps:[{title:"Review intake",description:"Confirm availability",details:{contacts:[{phone:"215-555-0148",email:"intake@example.test"}]}}]} as unknown as PlanWithSteps;
    expect(validateFamilyNoPii(detail).ok).toBe(true);
    detail.plan.steps[0].description = "Call 215-555-0148";
    expect(validateFamilyNoPii(detail).ok).toBe(false);
  });
});
