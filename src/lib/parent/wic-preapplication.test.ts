import { describe, expect, it, vi } from "vitest";
import {
  prepareWicPreapplication, WIC_PREAPPLICATION_CONTRACT as contract,
  WIC_PREAPPLICATION_ERROR, type WicPreapplicationInput,
} from "./wic-preapplication";

const now = new Date("2026-11-13T20:00:00Z");
const contact = {
  firstName: "Fictional", lastName: "Example", street: "123 Synthetic Lane",
  city: "Philadelphia", zip: "19104", county: "Philadelphia" as const,
  email: "fictional@example.test", phone: "215-555-0101", dateOfBirth: "1990-02-28",
};
const child = { firstName: "Test", lastName: "Child", dateOfBirth: "2023-06-15" };
const base: WicPreapplicationInput = {
  kind: "synthetic_rehearsal", applicationType: "new", beneficiaries: "children",
  appointmentPreference: "morning", contact, children: [child],
};

describe("fictional-only WIC pre-application preparation", () => {
  it("assembles the exact public child-only fields without a request, acknowledgment or outcome claim", () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      const prepared = prepareWicPreapplication(base, now);
      expect(prepared.preparedFields).toEqual({
        content_content_rblPreapplicationType_0: true, chkMom: false, chkKid: true,
        txtFirstName: "Fictional", txtLastName: "Example", txtStreet: "123 Synthetic Lane",
        txtCity: "Philadelphia", txtZip: "19104", ddlCounty: "51",
        txtEmail: "fictional@example.test", txtPhone: "215-555-0101", txtContactDOB: "02/28/1990", rbApptAM: true,
      });
      expect(prepared.childRows).toEqual([{ txtChildFirstName: "Test", txtChildLastName: "Child", txtChildBirthDate: "06/15/2023" }]);
      expect(prepared).toMatchObject({ kind: "fictional_only_preparation", preparationFieldsComplete: true,
        missingFactGroups: [], submissionReady: false, callbackRequest: "not_sent", appointment: "unconfirmed", enrollment: "unconfirmed",
        personalAcknowledgment: { id: "chkAcknowledgement", state: "not_recorded" } });
      expect(prepared.personalAcknowledgment.text).toContain("does not guarantee enrollment");
      expect(prepared.unverifiedRequirements).toContain("backend_validation_and_omitted_fields");
      expect(JSON.stringify(prepared)).not.toMatch(/SavePreapplication|ValidateChild|"method"|"headers"|"body"|"chkAcknowledgement":true/);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });

  it.each(["new", "reapplying", "transfer"] as const)("requires an explicit %s journey without borrowing the default new selection", applicationType => {
    const prepared = prepareWicPreapplication({ ...base, applicationType }, now);
    expect(prepared.preparedFields[contract.applicationTypes[applicationType].id]).toBe(true);
    expect(Object.keys(prepared.preparedFields).filter(key => key.startsWith("content_content_rblPreapplicationType"))).toHaveLength(1);
  });

  it("groups all missing initial facts without inventing names, a beneficiary or an appointment preference", () => {
    const prepared = prepareWicPreapplication({ kind: "synthetic_rehearsal" }, now);
    expect(prepared.preparedFields).toEqual({});
    expect(prepared.childRows).toEqual([]);
    expect(prepared.missingFactGroups).toEqual([
      { group: "application_type", fields: ["applicationType"] }, { group: "beneficiaries", fields: ["beneficiaries"] },
      { group: "contact", fields: ["contact.firstName", "contact.lastName", "contact.street", "contact.city", "contact.zip", "contact.county", "contact.email", "contact.phone", "contact.dateOfBirth"] },
      { group: "appointment_preference", fields: ["appointmentPreference"] },
    ]);
    expect(prepared.preparationFieldsComplete).toBe(false);
  });

  it("never substitutes Child or the contact's surname for missing child information", () => {
    const prepared = prepareWicPreapplication({ ...base, children: [{ dateOfBirth: child.dateOfBirth }, {}] }, now);
    expect(prepared.childRows).toEqual([{ txtChildBirthDate: "06/15/2023" }, {}]);
    expect(prepared.missingFactGroups).toEqual([
      { group: "child_1", fields: ["children.0.firstName", "children.0.lastName"] },
      { group: "child_2", fields: ["children.1.firstName", "children.1.lastName", "children.1.dateOfBirth"] },
    ]);
  });

  it("requires actual child rows when the child branch is selected", () => {
    expect(prepareWicPreapplication({ ...base, children: [] }, now).missingFactGroups).toEqual([{ group: "children", fields: ["children"] }]);
  });

  it.each(["pregnant", "postpartum", "breastfeeding"] as const)("prepares the %s maternal branch separately from contact identity", status => {
    const prepared = prepareWicPreapplication({ ...base, beneficiaries: "mother", children: undefined,
      mother: { firstName: "Different", lastName: "Person", dateOfBirth: "1991-05-12", status,
        ...(status === "pregnant" ? { expectedDeliveryDate: "2027-02-03" } : {}) } }, now);
    expect(prepared.preparedFields).toMatchObject({ chkMom: true, chkKid: false, txtMomFirstName: "Different", txtMomLastName: "Person", txtMomDOB: "05/12/1991",
      [contract.motherStatuses[status].id]: true });
    expect(prepared.childRows).toEqual([]);
    expect(prepared.missingFactGroups).toEqual([]);
    expect(prepared.preparedFields.txtDeliveryDate).toBe(status === "pregnant" ? "02/03/2027" : undefined);
  });

  it("groups missing maternal details and conditionally asks the pregnancy date", () => {
    const input = { ...base, beneficiaries: "mother", children: undefined };
    expect(prepareWicPreapplication(input, now).missingFactGroups).toEqual([{ group: "mother", fields: ["mother.firstName", "mother.lastName", "mother.dateOfBirth", "mother.status"] }]);
    expect(prepareWicPreapplication({ ...input, mother: { status: "pregnant" } }, now).missingFactGroups).toEqual([
      { group: "mother", fields: ["mother.firstName", "mother.lastName", "mother.dateOfBirth"] },
      { group: "pregnancy_date", fields: ["mother.expectedDeliveryDate"] },
    ]);
  });

  it("keeps maternal and child details together only when both branches are explicitly selected", () => {
    const prepared = prepareWicPreapplication({ ...base, beneficiaries: "mother_and_children",
      mother: { firstName: "Mother", lastName: "Example", dateOfBirth: "1990-02-28", status: "breastfeeding" } }, now);
    expect(prepared.preparedFields).toMatchObject({ chkMom: true, chkKid: true });
    expect(prepared.childRows).toHaveLength(1);
    expect(prepared.missingFactGroups).toEqual([]);
  });

  it.each([
    { ...base, kind: "live" }, { ...base, acknowledgment: true }, { ...base, signature: "Example" },
    { ...base, incomeAmount: 100 }, { ...base, ssn: "123-45-6789" },
    { ...base, contact: { ...contact, password: "secret" } },
    { ...base, children: [{ ...child, race: ["W"] }] },
    { ...base, children: [{ ...child, medicalAssistance: true }] },
    { ...base, mother: { status: "pregnant" } },
    { ...base, beneficiaries: "mother", children: [child] },
    { ...base, beneficiaries: "mother", children: undefined, mother: { status: "postpartum", expectedDeliveryDate: "2027-01-01" } },
  ])("rejects unsupported purpose, declarations, optional collection and incompatible branches", input => {
    expect(() => prepareWicPreapplication(input, now)).toThrow(WIC_PREAPPLICATION_ERROR);
  });

  it.each(["2025-02-29", "2026-13-01", "2026-11-14"])("rejects invalid or future birth dates %s", dateOfBirth => {
    expect(() => prepareWicPreapplication({ ...base, children: [{ ...child, dateOfBirth }] }, now)).toThrow(WIC_PREAPPLICATION_ERROR);
  });

  it("uses the family's local date for birth-date boundaries", () => {
    const input = { ...base, children: [{ ...child, dateOfBirth: "2026-11-14" }] };
    expect(() => prepareWicPreapplication(input, new Date("2026-11-14T04:59:59Z"))).toThrow(WIC_PREAPPLICATION_ERROR);
    expect(prepareWicPreapplication(input, new Date("2026-11-14T05:00:00Z")).childRows[0].txtChildBirthDate).toBe("11/14/2026");
  });

  it.each([
    { ...contact, firstName: "x".repeat(51) }, { ...contact, street: "x".repeat(101) },
    { ...contact, email: "not-an-email" }, { ...contact, email: "123-45-6789@example.test" }, { ...contact, phone: "123-45-6789" },
    { ...contact, firstName: "123-45-6789" }, { ...contact, firstName: "<script>" },
    { ...contact, zip: "90210" }, { ...contact, county: "Bucks" },
  ])("rejects invalid fields without truncation or echoing private values", input => {
    expect(() => prepareWicPreapplication({ ...base, contact: input }, now)).toThrow(WIC_PREAPPLICATION_ERROR);
  });

  it("validates contact, maternal and delivery dates without deciding clinical eligibility", () => {
    expect(() => prepareWicPreapplication({ ...base, contact: { ...contact, dateOfBirth: "2026-11-14" } }, now)).toThrow(WIC_PREAPPLICATION_ERROR);
    const input = { ...base, beneficiaries: "mother", children: undefined,
      mother: { firstName: "Test", lastName: "Example", dateOfBirth: "1992-02-29", status: "pregnant" } };
    expect(() => prepareWicPreapplication({ ...input, mother: { ...input.mother, dateOfBirth: "2026-11-14" } }, now)).toThrow(WIC_PREAPPLICATION_ERROR);
    expect(() => prepareWicPreapplication({ ...input, mother: { ...input.mother, expectedDeliveryDate: "2027-02-29" } }, now)).toThrow(WIC_PREAPPLICATION_ERROR);
    // An expected date may be past without establishing the family's current medical status.
    expect(prepareWicPreapplication({ ...input, mother: { ...input.mother, expectedDeliveryDate: "2026-11-10" } }, now).preparedFields.txtDeliveryDate).toBe("11/10/2026");
  });

  it("rejects a delivery date before the mother's known birth date", () => {
    expect(() => prepareWicPreapplication({ ...base, beneficiaries: "mother", children: undefined,
      mother: { firstName: "Test", lastName: "Example", dateOfBirth: "1992-02-29", status: "pregnant", expectedDeliveryDate: "1992-02-28" } }, now)).toThrow(WIC_PREAPPLICATION_ERROR);
  });

  it.each([new Date("invalid"), new Date("2026-11-13T18:57:45.282Z"), new Date(contract.verifiedUntil)])("requires a current source check at %s", date => {
    expect(() => prepareWicPreapplication(base, date)).toThrow(WIC_PREAPPLICATION_ERROR);
  });

  it("keeps the source scope and remaining provider evidence explicit", () => {
    expect(Date.parse(contract.verifiedUntil) - Date.parse(contract.sourceCheckedAt)).toBe(7 * 86400000);
    expect(contract.semanticLimits.join(" ")).toContain("offline contract; it does not establish provider permission");
    expect(contract.sourceSha256).toBe("c6daa011c75c4b21838cea17a579d1097c09b00f0584e668eede2a343dd0b774");
    expect(contract.displayedSuccessText).toContain("reach out to you to schedule an appointment");
    expect(contract.semanticLimits.join(" ")).toContain("backend requirements and acceptance of omitted fields have not been tested");
    expect(prepareWicPreapplication(base, now)).toMatchObject({ sourceCheckedAt: contract.sourceCheckedAt, verifiedUntil: contract.verifiedUntil });
  });
});
