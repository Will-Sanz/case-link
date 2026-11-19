import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, drawObject } from "pdf-lib";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { pecoCapPreparationSnapshotSchema, renderPecoCapIncomePreparationPacket, type PecoCapDraftInput, type PecoCapPreparationSnapshot } from "./peco-cap-draft";
import type { PecoCapIncomeInput } from "./peco-cap-income";

const template = readFileSync("tests/fixtures/parent/peco-cap-2026.pdf");
const now = new Date("2026-10-26T12:00:00Z");
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const error = "The PECO income preparation packet could not be created from the supplied information.";
const draft: PecoCapDraftInput = {
  accountNumber: "9000000001",
  applicant: { firstName: "María", lastName: "Rivera", dateOfBirth: "1988-04-15", incomeSource: "Employment" },
  address: { street: "123 Synthetic Way", city: "Philadelphia", state: "PA", zip: "19104" },
  householdMembers: [],
};

async function proof(
  pages = 1,
  mutate?: (pdf: PDFDocument) => void,
  period = "September 27 - October 26, 2026",
) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#274c77" } })
    .png().toBuffer();
  const image = await pdf.embedPng(png);
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`SYNTHETIC employer evidence ${i + 1}`, { x: 30, y: 750, font, size: 13 });
    page.drawText(`Gross pay USD 2000.00 | ${period}`, { x: 30, y: 720, font, size: 10 });
    page.drawText(`Original bottom edge ${i + 1}`, { x: 10, y: 8, font, size: 8 });
    page.drawImage(image, { x: 30, y: 560, width: 96, height: 96 });
  }
  mutate?.(pdf);
  return pdf.save();
}

function income(bytes: Uint8Array): PecoCapIncomeInput {
  const binding: PecoCapIncomeInput["scope"]["binding"] = {
    requestId: "request-1",
    householdId: "household-1",
    requestVersion: 2,
    accountRef: "account-1",
    programId: "peco-cap",
    need: "electricity",
    purpose: "income_preparation",
  };
  const validation = {
    binding,
    provenanceRef: "source-check-1",
    verifiedAt: "2026-10-26T10:00:00Z",
    validUntil: "2026-12-01T00:00:00Z",
  };
  return structuredClone({
    scope: {
      binding,
      applicantSubjectId: "adult-1",
      journey: "new_enrollment",
      currentCapState: "not_enrolled",
      requestState: "active",
      mandate: {
        expiresAt: validation.validUntil,
        revoked: false,
        recipientIds: ["peco-cap"],
        allowedActions: ["prepare"],
        allowedData: ["household", "income", "documents"]
      },
      grant: { expiresAt: validation.validUntil, revoked: false },
      incomeConsent: { version: "income-v1", expiresAt: validation.validUntil, subjectIds: ["adult-1"] },
      documentConsent: { version: "document-v1", expiresAt: validation.validUntil, documentIds: ["proof-1"] },
    },
    household: {
      ...validation,
      complete: true,
      people: [{
        subjectId: "adult-1",
        adult: true,
        inventory: {
          ...validation,
          state: "sources",
          complete: true,
          sources: [{ sourceId: "job-1", kind: "employment" }]
        }
      }],
    },
    documents: [{
      documentId: "proof-1",
      sha256: hash(bytes),
      binding,
      provenanceRef: "original-check-1",
      status: "validated",
      originalAvailable: true,
      uploadConfirmedAt: "2026-10-26T09:00:00Z",
      validatedAt: validation.verifiedAt,
      expiresAt: "2026-10-27T10:00:00Z",
      coverage: [{
        subjectId: "adult-1",
        sourceId: "job-1",
        proofKind: "pay_stub",
        grossBasis: "gross",
        periodStart: "2026-09-27",
        periodEnd: "2026-10-26",
        detailsVerified: true,
        provenanceRef: "proof-check-1"
      }],
    }],
    bundles: [{
      ...validation,
      basis: "30_days",
      periodStart: "2026-09-27",
      periodEnd: "2026-10-26",
      documentIds: ["proof-1"],
      sourceCoverage: [{
        subjectId: "adult-1",
        sourceId: "job-1",
        basis: "30_days",
        applicationAsOf: "2026-10-26",
        documentRefs: [{ documentId: "proof-1", sha256: hash(bytes) }],
        proofRequirement: "required",
        completenessVerified: true,
        applicabilityRule: "current_income_period",
        applicabilityRef: "applicability-check-1"
      }],
      representativeness: "verified",
      annualGrossSummary: null,
    }],
    zeroIncome: null,
    liheap: null,
  });
}

function preparation(facts: PecoCapIncomeInput, form: unknown = draft): PecoCapPreparationSnapshot {
  const input = {
    id: "preparation-1", revision: 1, binding: structuredClone(facts.scope.binding),
    subjectIds: facts.household.people.map(person => person.subjectId),
    confirmedAt: facts.household.verifiedAt, validUntil: facts.household.validUntil,
    retentionUntil: facts.household.validUntil, details: form,
  };
  const parsed = pecoCapPreparationSnapshotSchema.safeParse(input);
  const snapshot = parsed.success ? parsed.data : input;
  facts.scope.preparationSnapshot = { id: input.id, revision: input.revision, sha256: hash(JSON.stringify(snapshot)) };
  return snapshot as PecoCapPreparationSnapshot;
}

function addAdult(facts: PecoCapIncomeInput) {
  facts.household.people.push({
    ...structuredClone(facts.household.people[0]), subjectId: "adult-2",
    inventory: { ...structuredClone(facts.household.people[0].inventory!), sources: [{ sourceId: "job-2", kind: "employment" }] },
  });
  facts.scope.incomeConsent.subjectIds.push("adult-2");
  facts.documents[0].coverage.push({ ...facts.documents[0].coverage[0], subjectId: "adult-2", sourceId: "job-2" });
  facts.bundles[0].sourceCoverage.push({ ...structuredClone(facts.bundles[0].sourceCoverage[0]), subjectId: "adult-2", sourceId: "job-2" });
}

async function render(bytes: Uint8Array, facts = income(bytes), form: unknown = draft, at = now) {
  return renderPecoCapIncomePreparationPacket(template, preparation(facts, form), facts, [{ documentId: "proof-1", bytes }], at);
}

describe("offline PECO standard-income preparation packet", () => {
  it.each([
    (form: PecoCapDraftInput) => { form.applicant = { ...form.applicant, firstName: "Different", lastName: "Person" }; },
    (form: PecoCapDraftInput) => { form.applicant.dateOfBirth = "1988-09-20"; },
    (form: PecoCapDraftInput) => { form.accountNumber = "9999999999"; },
  ])("rejects substituted printed identity or account against the same trusted income source", async (mutate) => {
    const bytes = await proof();
    const facts = income(bytes);
    const snapshot = preparation(facts);
    mutate(snapshot.details);
    const result = await renderPecoCapIncomePreparationPacket(template, snapshot, facts, [{ documentId: "proof-1", bytes }], now)
      .then(() => "created", (caught: Error) => caught.message);
    expect(result).toBe(error);
  });

  it("binds a second adult's printed identity to the already recorded snapshot", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    addAdult(facts);
    const snapshot = preparation(facts, { ...draft, householdMembers: [{
      ...draft.applicant, firstName: "Elena", dateOfBirth: "1989-04-15", relationship: "Sibling",
    }] });
    const original = await renderPecoCapIncomePreparationPacket(template, snapshot, facts, [{ documentId: "proof-1", bytes }], now);
    snapshot.details.householdMembers[0] = {
      ...snapshot.details.householdMembers[0], firstName: "Different", lastName: "Person", dateOfBirth: "1989-09-20",
    };
    const result = await renderPecoCapIncomePreparationPacket(template, snapshot, facts, [{ documentId: "proof-1", bytes }], now)
      .then(() => "created", (caught: Error) => caught.message);
    expect(result).toBe(error);
    expect(original.manifest.preparationSnapshot).toEqual(facts.scope.preparationSnapshot);
  });

  it.each([
    (facts: PecoCapIncomeInput) => { delete facts.scope.preparationSnapshot; },
    (facts: PecoCapIncomeInput) => { facts.scope.preparationSnapshot!.id = "different"; },
    (facts: PecoCapIncomeInput) => { facts.scope.preparationSnapshot!.revision++; },
    (facts: PecoCapIncomeInput) => { facts.scope.preparationSnapshot!.sha256 = "0".repeat(64); },
  ])("requires the trusted source's exact reference instead of a self-described snapshot", async (mutate) => {
    const bytes = await proof();
    const facts = income(bytes);
    const snapshot = preparation(facts);
    mutate(facts);
    await expect(renderPecoCapIncomePreparationPacket(template, snapshot, facts, [{ documentId: "proof-1", bytes }], now))
      .rejects.toMatchObject({ message: error });
  });

  it.each([
    (snapshot: PecoCapPreparationSnapshot) => { snapshot.binding.householdId = "other"; },
    (snapshot: PecoCapPreparationSnapshot) => { snapshot.binding.requestId = "other"; },
    (snapshot: PecoCapPreparationSnapshot) => { snapshot.binding.requestVersion++; },
    (snapshot: PecoCapPreparationSnapshot) => { snapshot.binding.accountRef = "other"; },
    (snapshot: PecoCapPreparationSnapshot) => { snapshot.subjectIds = ["different-adult"]; },
    (snapshot: PecoCapPreparationSnapshot) => { snapshot.subjectIds.push("adult-1"); },
    (snapshot: PecoCapPreparationSnapshot) => { snapshot.subjectIds = []; },
    (snapshot: PecoCapPreparationSnapshot) => { snapshot.confirmedAt = "2026-10-26T13:00:00Z"; },
    (snapshot: PecoCapPreparationSnapshot) => { snapshot.validUntil = now.toISOString(); },
    (snapshot: PecoCapPreparationSnapshot) => { snapshot.retentionUntil = now.toISOString(); },
  ])("rejects an internally inconsistent or expired trusted projection even with a matching digest", async (mutate) => {
    const bytes = await proof();
    const facts = income(bytes);
    const snapshot = preparation(facts);
    mutate(snapshot);
    facts.scope.preparationSnapshot!.sha256 = hash(JSON.stringify(snapshot));
    await expect(renderPecoCapIncomePreparationPacket(template, snapshot, facts, [{ documentId: "proof-1", bytes }], now))
      .rejects.toMatchObject({ message: error });
  });

  it("checks each person's age metadata rather than accepting the same total adult count", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    addAdult(facts);
    facts.household.people.push({ subjectId: "minor-1", adult: false, inventory: null });
    const snapshot = preparation(facts, { ...draft, householdMembers: [
      { ...draft.applicant, firstName: "Elena", dateOfBirth: "1989-04-15", relationship: "Sibling" },
      { ...draft.applicant, dateOfBirth: "2017-01-01", relationship: "Child", incomeSource: "None" },
    ] });
    for (const subjectIds of [
      ["adult-1", "minor-1", "adult-2"], ["adult-1", "adult-2", "adult-2"], ["adult-2", "adult-1", "minor-1"],
    ]) {
      snapshot.subjectIds = subjectIds;
      facts.scope.preparationSnapshot!.sha256 = hash(JSON.stringify(snapshot));
      await expect(renderPecoCapIncomePreparationPacket(template, snapshot, facts, [{ documentId: "proof-1", bytes }], now))
        .rejects.toMatchObject({ message: error });
    }
  });

  it("uses an authorized corrected snapshot and keeps the previous artifact reference unchanged", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    const originalSnapshot = preparation(facts);
    const original = await renderPecoCapIncomePreparationPacket(template, originalSnapshot, facts, [{ documentId: "proof-1", bytes }], now);
    const corrected = structuredClone(facts);
    for (const record of [corrected.scope, corrected.household, corrected.household.people[0].inventory!, ...corrected.documents, ...corrected.bundles])
      record.binding.requestVersion = 3;
    const snapshot = preparation(corrected, { ...draft, applicant: { ...draft.applicant, firstName: "María Elena" } });
    snapshot.revision = 2;
    corrected.scope.preparationSnapshot = { id: snapshot.id, revision: snapshot.revision, sha256: hash(JSON.stringify(snapshot)) };
    await expect(renderPecoCapIncomePreparationPacket(template, originalSnapshot, corrected, [{ documentId: "proof-1", bytes }], now))
      .rejects.toMatchObject({ message: error });
    const result = await renderPecoCapIncomePreparationPacket(template, snapshot, corrected, [{ documentId: "proof-1", bytes }], now);
    expect(result.manifest.preparationSnapshot).toEqual(corrected.scope.preparationSnapshot);
    expect(result.manifest.formInputSha256).not.toBe(original.manifest.formInputSha256);
    expect(original.manifest.preparationSnapshot).toEqual(facts.scope.preparationSnapshot);
    expect(original.manifest.scope.requestVersion).toBe(2);
  });

  it.each(["validUntil", "retentionUntil"] as const)("keeps the original snapshot %s deadline when reused", async field => {
    const bytes = await proof();
    const facts = income(bytes);
    const snapshot = preparation(facts);
    snapshot[field] = "2026-10-26T13:00:00Z";
    facts.scope.preparationSnapshot!.sha256 = hash(JSON.stringify(snapshot));
    const result = await renderPecoCapIncomePreparationPacket(template, snapshot, facts, [{ documentId: "proof-1", bytes }], now);
    expect(result.manifest.validUntil).toBe("2026-10-26T13:00:00.000Z");
    expect(result.manifest.retentionUntil).toBe(result.manifest.validUntil);
    expect(snapshot.confirmedAt).toBe("2026-10-26T10:00:00Z");
  });

  it("binds unchanged originals, exact parsed form, source certification and final copied artifact", async () => {
    const bytes = await proof(2);
    const originalHash = hash(bytes);
    const result = await render(bytes);
    expect(result.manifest).toMatchObject({
      kind: "unsigned_preparation_rehearsal",
      pageCount: 4,
      basis: "30_days",
      applicationAsOf: "2026-10-26",
      validUntil: "2026-10-27T04:00:00.000Z",
      retentionUntil: "2026-10-27T10:00:00.000Z",
      scope: income(bytes).scope.binding,
      formInputSha256: hash(JSON.stringify(draft)),
      templateSha256: hash(template),
      certificationTemplateSha256: hash(template),
      artifactSha256: hash(result.bytes),
      originals: [{
        documentId: "proof-1",
        sourceSha256: originalHash,
        pageCount: 2,
        outputStartPage: 3,
        outputEndPage: 4
      }],
    });
    expect(hash(bytes)).toBe(originalHash);
    expect(hash(template)).toBe(result.manifest.templateSha256);
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    expect(result.manifest).not.toHaveProperty("submissionReady");
    expect(result.manifest).not.toHaveProperty("certificationComplete");
  });

  it("uses one original explicitly covering two sources once", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    facts.household.people[0].inventory!.sources.push({ sourceId: "job-2", kind: "employment" });
    facts.documents[0].coverage.push({ ...facts.documents[0].coverage[0], sourceId: "job-2" });
    facts.bundles[0].sourceCoverage.push({ ...structuredClone(facts.bundles[0].sourceCoverage[0]), sourceId: "job-2" });
    const result = await render(bytes, facts);
    expect(result.manifest.originals).toHaveLength(1);
    expect(result.manifest.pageCount).toBe(3);
  });

  it("uses the selected annual basis and its deadline without borrowing an unselected period's expiry", async () => {
    const bytes = await proof(1, undefined, "October 27, 2025 - October 26, 2026");
    const facts = income(bytes);
    facts.documents[0].coverage[0].proofKind = "employer_letter";
    facts.documents[0].coverage[0].periodStart = "2025-10-27";
    const summary = {
      annualGrossCents: 2400000, basis: "gross" as const, comparisonRef: "comparable-source-totals",
      provenanceRef: "annual-summary-1", sourceRefs: [{ subjectId: "adult-1", sourceId: "job-1" }],
    };
    facts.bundles[0].annualGrossSummary = summary;
    facts.bundles[0].validUntil = "2026-10-26T13:00:00Z";
    const annual = structuredClone(facts.bundles[0]);
    annual.basis = "12_months";
    annual.periodStart = "2025-10-27";
    annual.validUntil = "2026-10-26T14:00:00Z";
    annual.sourceCoverage[0].basis = "12_months";
    annual.annualGrossSummary!.annualGrossCents = 1200000;
    facts.bundles.push(annual);
    const result = await render(bytes, facts);
    expect(result.manifest).toMatchObject({
      basis: "12_months", applicationAsOf: "2026-10-26", retentionUntil: "2026-10-26T14:00:00.000Z",
      originals: [{ documentId: "proof-1", sourceSha256: hash(bytes) }],
    });
  });

  it("copies distinct originals in the assessment order with contiguous correct ranges", async () => {
    const bytes = await proof();
    const second = await proof(2);
    const facts = income(bytes);
    facts.household.people[0].inventory!.sources.push({ sourceId: "job-2", kind: "employment" });
    facts.documents.push({
      ...structuredClone(facts.documents[0]),
      documentId: "proof-2",
      sha256: hash(second),
      coverage: [{
        ...facts.documents[0].coverage[0],
        sourceId: "job-2"
      }]
    });
    facts.scope.documentConsent!.documentIds.push("proof-2");
    facts.bundles[0].documentIds.push("proof-2");
    facts.bundles[0].sourceCoverage.push({
      ...structuredClone(facts.bundles[0].sourceCoverage[0]),
      sourceId: "job-2",
      documentRefs: [{
        documentId: "proof-2",
        sha256: hash(second)
      }]
    });
    const result = await renderPecoCapIncomePreparationPacket(template, preparation(facts), facts,
      [{ documentId: "proof-2", bytes: second }, { documentId: "proof-1", bytes }], now);
    expect(result.manifest.pageCount).toBe(5);
    expect(result.manifest.originals).toEqual([
      { documentId: "proof-1", sourceSha256: hash(bytes), pageCount: 1, outputStartPage: 3, outputEndPage: 3 },
      { documentId: "proof-2", sourceSha256: hash(second), pageCount: 2, outputStartPage: 4, outputEndPage: 5 },
    ]);
  });

  it("rejects structurally partial household projections without claiming names are authenticated", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    const withChild = {
      ...draft, householdMembers: [{
        ...draft.applicant, dateOfBirth: "2017-01-01", relationship: "Child", incomeSource: "None",
      }]
    };
    await expect(render(bytes, facts, withChild)).rejects.toMatchObject({ message: error });
    facts.household.people.push({ subjectId: "minor-1", adult: false, inventory: null });
    await expect(render(bytes, facts, {
      ...withChild, householdMembers: [{
        ...withChild.householdMembers[0], dateOfBirth: "1980-01-01",
      }]
    })).rejects.toMatchObject({ message: error });
  });

  it("requires the applicant to be an adult today in Pennsylvania even after UTC midnight", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    facts.household.people.push({ subjectId: "minor-1", adult: false, inventory: null });
    const form = {
      ...draft, applicant: { ...draft.applicant, dateOfBirth: "2008-10-27" }, householdMembers: [{
        ...draft.applicant, dateOfBirth: "1980-01-01", relationship: "Relative",
      }]
    };
    await expect(render(bytes, facts, form, new Date("2026-10-27T02:30:00Z")))
      .rejects.toMatchObject({ message: error });
  });

  it("keeps continuation pages before proofs and calculates the final total once", async () => {
    const bytes = await proof(5);
    const facts = income(bytes);
    facts.household.people.push(...Array.from({ length: 28 }, (_, i) => ({
      subjectId: `minor-${i}`, adult: false, inventory: null,
    })));
    const form = {
      ...draft,
      householdMembers: Array.from({ length: 28 }, (_, i) => ({
        ...draft.applicant, firstName: `Demo${i}`, dateOfBirth: "2017-01-01", incomeSource: "None", relationship: "Child",
      }))
    };
    const result = await render(bytes, facts, form);
    expect(result.manifest.pageCount).toBe(9);
    expect(result.manifest.originals[0]).toMatchObject({ outputStartPage: 5, outputEndPage: 9 });
  });

  it("produces deterministic bytes and changes bindings when actual facts or selected proof change", async () => {
    const bytes = await proof();
    const first = await render(bytes);
    expect((await render(bytes)).bytes).toEqual(first.bytes);
    const changed = await render(bytes, income(bytes), { ...draft, address: { ...draft.address, apartment: "2B" } });
    expect(changed.manifest.formInputSha256).not.toBe(first.manifest.formInputSha256);
    expect(changed.manifest.artifactSha256).not.toBe(first.manifest.artifactSha256);
    const secondProof = await proof(2);
    const changedProof = await render(secondProof);
    expect(changedProof.manifest.originals).not.toEqual(first.manifest.originals);
    expect(changedProof.manifest.artifactSha256).not.toBe(first.manifest.artifactSha256);
  });

  it("snapshots the date, template, all original bytes and metadata before asynchronous work", async () => {
    const bytes = await proof();
    const copy = Uint8Array.from(template);
    const source = income(bytes);
    const sourceHash = hash(bytes);
    const at = new Date(now);
    const form = preparation(source);
    const pending = renderPecoCapIncomePreparationPacket(copy, form, source, [{ documentId: "proof-1", bytes }], at);
    copy.fill(0); bytes.fill(0); source.scope.binding.requestVersion = 999; form.details.accountNumber = "changed"; at.setFullYear(2099);
    const result = await pending;
    expect(result.manifest.scope.requestVersion).toBe(2);
    expect(result.manifest.originals[0].sourceSha256).toBe(sourceHash);
    expect(result.manifest.formInputSha256).toBe(hash(JSON.stringify(draft)));
    expect(result.manifest.validUntil).toBe("2026-10-27T04:00:00.000Z");
  });

  it("caps retention at original deadlines without extending them when other facts are reused", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    facts.documents[0].expiresAt = "2026-10-26T13:00:00Z";
    const result = await render(bytes, facts);
    expect(result.manifest.retentionUntil).toBe("2026-10-26T13:00:00.000Z");
    expect(result.manifest.validUntil).toBe(result.manifest.retentionUntil);
    facts.documents[0].expiresAt = "2026-12-01T00:00:00Z";
    expect((await render(bytes, facts)).manifest.retentionUntil).toBe("2026-10-27T10:00:00.000Z");
  });

  it("uses the next Pennsylvania midnight across the 25-hour DST day", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    // 01:30 EDT, before the clock falls back; the next midnight is 05:00 UTC, not 04:00.
    const at = new Date("2026-11-01T05:30:00Z");
    for (const record of [facts.household, facts.household.people[0].inventory!, facts.bundles[0]])
      record.verifiedAt = "2026-11-01T04:00:00Z";
    facts.documents[0].uploadConfirmedAt = "2026-11-01T04:00:00Z";
    facts.documents[0].validatedAt = "2026-11-01T05:15:00Z";
    facts.documents[0].expiresAt = "2026-11-02T10:00:00Z";
    facts.documents[0].coverage[0].periodStart = "2026-10-03";
    facts.documents[0].coverage[0].periodEnd = "2026-11-01";
    facts.bundles[0].periodStart = "2026-10-03";
    facts.bundles[0].periodEnd = "2026-11-01";
    facts.bundles[0].sourceCoverage[0].applicationAsOf = "2026-11-01";
    const result = await render(bytes, facts, draft, at);
    expect(result.manifest.validUntil).toBe("2026-11-02T05:00:00.000Z");
    expect(result.manifest.retentionUntil).toBe("2026-11-02T05:15:00.000Z");
  });

  it("ignores unused expired proof and alternative-period deadlines", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    facts.documents.push({
      ...structuredClone(facts.documents[0]),
      documentId: "unused",
      expiresAt: "2020-01-01T00:00:00Z",
      coverage: []
    });
    facts.bundles.push({
      ...structuredClone(facts.bundles[0]),
      basis: "12_months",
      validUntil: "2020-01-01T00:00:00Z",
      sourceCoverage: []
    });
    expect((await render(bytes, facts)).manifest.retentionUntil).toBe("2026-10-27T10:00:00.000Z");
  });

  it("does not let an unused empty minor inventory shorten retention or readiness", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    facts.household.people.push({
      subjectId: "minor-1",
      adult: false,
      inventory: {
        ...structuredClone(facts.household.people[0].inventory!),
        state: "sources",
        sources: [],
        validUntil: "2020-01-01T00:00:00Z",
      }
    });
    const result = await render(bytes, facts, {
      ...draft, householdMembers: [{
        ...draft.applicant, dateOfBirth: "2017-01-01", incomeSource: "None", relationship: "Child",
      }]
    });
    expect(result.manifest.retentionUntil).toBe("2026-10-27T10:00:00.000Z");
    expect(result.manifest.validUntil).toBe("2026-10-27T04:00:00.000Z");
  });

  it.each(["mandate", "grant", "incomeConsent", "documentConsent"] as const)(
    "retains the used %s expiry", async (field) => {
      const bytes = await proof();
      const facts = income(bytes);
      facts.scope[field]!.expiresAt = "2026-10-26T13:00:00Z";
      expect((await render(bytes, facts)).manifest.retentionUntil).toBe("2026-10-26T13:00:00.000Z");
    },
  );

  it.each([
    (facts: PecoCapIncomeInput) => { facts.scope.binding = { ...facts.scope.binding, requestVersion: 3 }; },
    (facts: PecoCapIncomeInput) => {
      facts.documents[0].binding = {
        ...facts.documents[0].binding,
        householdId: "other"
      };
    },
    (facts: PecoCapIncomeInput) => { facts.scope.mandate.revoked = true; },
    (facts: PecoCapIncomeInput) => { facts.scope.documentConsent!.expiresAt = "2020-01-01T00:00:00Z"; },
    (facts: PecoCapIncomeInput) => { facts.documents[0].expiresAt = "2020-01-01T00:00:00Z"; },
    (facts: PecoCapIncomeInput) => { facts.scope.requestState = "cancelled"; },
    (facts: PecoCapIncomeInput) => { facts.bundles = []; },
  ])("refuses stale, corrected, cancelled or incomplete evidence before copying", async (mutate) => {
    const bytes = await proof();
    const facts = income(bytes); mutate(facts);
    await expect(render(bytes, facts)).rejects.toMatchObject({ message: error });
  });

  it("rejects missing, extra, duplicate, changed bytes and private-channel metadata generically", async () => {
    const bytes = await proof();
    const supplied = { documentId: "proof-1", bytes };
    const facts = income(bytes);
    const snapshot = preparation(facts);
    for (const originals of [[], [supplied, supplied], [{ ...supplied, documentId: "wrong" }],
    [{ ...supplied, bytes: bytes.subarray(1) }], [supplied, { ...supplied, documentId: "extra" }],
    [{ ...supplied, privateFilename: "DO NOT ECHO" }]]) {
      await expect(renderPecoCapIncomePreparationPacket(template, snapshot, facts, originals, now))
        .rejects.toMatchObject({ message: error });
    }
    await expect(render(bytes, income(bytes), {
      ...draft,
      ssn: "DO NOT ECHO"
    })).rejects.toMatchObject({ message: error });
    await expect(renderPecoCapIncomePreparationPacket(template.subarray(1), snapshot, facts, [supplied], now))
      .rejects.toMatchObject({ message: error });
  });

  it("binds two selected aliases to one physical proof copy with the same exact range", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    facts.household.people[0].inventory!.sources.push({ sourceId: "job-2", kind: "employment" });
    facts.documents.push({
      ...structuredClone(facts.documents[0]),
      documentId: "proof-2",
      coverage: [{ ...facts.documents[0].coverage[0], sourceId: "job-2" }]
    });
    facts.scope.documentConsent!.documentIds.push("proof-2");
    facts.bundles[0].documentIds.push("proof-2");
    facts.bundles[0].sourceCoverage.push({
      ...structuredClone(facts.bundles[0].sourceCoverage[0]),
      sourceId: "job-2",
      documentRefs: [{ documentId: "proof-2", sha256: hash(bytes) }]
    });
    const result = await renderPecoCapIncomePreparationPacket(template, preparation(facts), facts,
      [{ documentId: "proof-1", bytes }, { documentId: "proof-2", bytes }], now);
    expect(result.manifest.pageCount).toBe(3);
    expect(result.manifest.originals).toEqual([
      { documentId: "proof-1", sourceSha256: hash(bytes), pageCount: 1, outputStartPage: 3, outputEndPage: 3 },
      { documentId: "proof-2", sourceSha256: hash(bytes), pageCount: 1, outputStartPage: 3, outputEndPage: 3 },
    ]);
    facts.documents[1].expiresAt = "2026-10-26T13:00:00Z";
    const earlier = await renderPecoCapIncomePreparationPacket(template, preparation(facts), facts,
      [{ documentId: "proof-1", bytes }, { documentId: "proof-2", bytes }], now);
    expect(earlier.manifest.retentionUntil).toBe("2026-10-26T13:00:00.000Z");
  });

  it.each([
    (pdf: PDFDocument) => { pdf.getForm().createTextField("synthetic"); },
    (pdf: PDFDocument) => { pdf.catalog.set(PDFName.of("Perms"), pdf.context.obj({})); },
    (pdf: PDFDocument) => { pdf.catalog.set(PDFName.of("ByteRange"), pdf.context.obj([0, 1, 2, 3])); },
    (pdf: PDFDocument) => { pdf.catalog.set(PDFName.of("DocMDP"), pdf.context.obj({})); },
    (pdf: PDFDocument) => { pdf.context.register(pdf.context.obj({ Type: "Sig" })); },
    (pdf: PDFDocument) => { pdf.context.register(pdf.context.obj({ Type: pdf.context.register(PDFName.of("Sig")) })); },
    (pdf: PDFDocument) => { pdf.context.register(pdf.context.obj({ FT: "Tx" })); },
    (pdf: PDFDocument) => { pdf.context.register(pdf.context.obj({ Subtype: "Widget" })); },
    (pdf: PDFDocument) => { pdf.getPage(0).node.set(PDFName.of("AA"), pdf.context.obj({})); },
    (pdf: PDFDocument) => { pdf.catalog.set(PDFName.of("OCProperties"), pdf.context.obj({})); },
    (pdf: PDFDocument) => { pdf.context.register(pdf.context.obj({ Type: "OCG" })); },
    (pdf: PDFDocument) => { pdf.getPage(0).node.set(PDFName.of("UserUnit"), pdf.context.obj(2)); },
    (pdf: PDFDocument) => { pdf.getPage(0).setRotation(degrees(90)); },
    (pdf: PDFDocument) => { pdf.getPage(0).setCropBox(0, 0, 600, 780); },
    (pdf: PDFDocument) => { pdf.getPage(0).setTrimBox(0, 0, 600, 780); },
    (pdf: PDFDocument) => { pdf.getPage(0).setSize(600, 780); },
    (pdf: PDFDocument) => {
      pdf.getPage(0).node.addAnnot(pdf.context.register(pdf.context.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [0, 0, 20, 20],
        Contents: PDFString.of("Note")
      })));
    },
    (pdf: PDFDocument) => {
      pdf.catalog.set(PDFName.of("OpenAction"), pdf.context.obj({
        S: "JavaScript",
        JS: PDFString.of("alert(1)")
      }));
    },
  ])("rejects unsupported signed, interactive, annotated, active or altered-geometry evidence", async (mutate) => {
    const bytes = await proof(1, mutate);
    await expect(render(bytes)).rejects.toMatchObject({ message: error });
  });

  it("preserves existing five-page and ten-megabyte proof boundaries", async () => {
    await expect(render(await proof(6))).rejects.toMatchObject({ message: error });
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(render(oversized)).rejects.toMatchObject({ message: error });
  });

  it("refuses eleven supplied originals without expanding the operation limit", async () => {
    const bytes = await proof();
    const facts = income(bytes);
    await expect(renderPecoCapIncomePreparationPacket(template, preparation(facts), facts,
      Array.from({ length: 11 }, (_, i) => ({ documentId: `proof-${i}`, bytes })), now))
      .rejects.toMatchObject({ message: error });
  });

  it("rejects a combined packet over ten megabytes even when individual proofs fit", async () => {
    const largeProof = async () => {
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([612, 792]);
      const raster = randomBytes(1400 * 1300 * 3);
      // Keep noise from accidentally spelling a PDF action token in the existing conservative inspector.
      for (let i = 0; i < raster.length; i++) if (raster[i] === 47) raster[i] = 48;
      const image = pdf.context.register(pdf.context.stream(raster, {
        Type: "XObject",
        Subtype: "Image",
        Width: 1400,
        Height: 1300,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
      }));
      const key = page.node.newXObject("Evidence", image);
      page.pushOperators(drawObject(key));
      return pdf.save();
    };
    const first = await largeProof();
    const second = await largeProof();
    expect(first.length).toBeLessThan(10 * 1024 * 1024);
    expect(second.length).toBeLessThan(10 * 1024 * 1024);
    expect((await render(first)).bytes.length).toBeLessThan(10 * 1024 * 1024);
    const facts = income(first);
    facts.household.people[0].inventory!.sources.push({ sourceId: "job-2", kind: "employment" });
    facts.documents.push({
      ...structuredClone(facts.documents[0]),
      documentId: "proof-2",
      sha256: hash(second),
      coverage: [{ ...facts.documents[0].coverage[0], sourceId: "job-2" }]
    });
    facts.scope.documentConsent!.documentIds.push("proof-2");
    facts.bundles[0].documentIds.push("proof-2");
    facts.bundles[0].sourceCoverage.push({
      ...structuredClone(facts.bundles[0].sourceCoverage[0]),
      sourceId: "job-2",
      documentRefs: [{ documentId: "proof-2", sha256: hash(second) }]
    });
    const outcome = await renderPecoCapIncomePreparationPacket(template, preparation(facts), facts,
      [{ documentId: "proof-1", bytes: first }, { documentId: "proof-2", bytes: second }], now)
      .then(() => "created", (caught: Error) => caught.message);
    expect(outcome).toBe(error);
  });
});
