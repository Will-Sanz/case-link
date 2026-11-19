import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import type { PecoCapIncomeInput } from "../src/lib/parent/peco-cap-income";
import { prepareFictionalPecoApplicationDraft, type FictionalPecoPreparationContext } from "../src/lib/parent/peco-application-preparation";
import { PECO_ACCOUNT_AUTHORITY_STATEMENT, PECO_APPLICATION_NOTICE_VERSION, PECO_APPLICATION_SOURCE, PECO_SUBJECT_AUTHORITY_STATEMENT, pecoApplicationLeaves, type PecoApplicationFields } from "../src/lib/parent/peco-application-fields";
import { pecoApplicationSnapshotSchema } from "../src/lib/parent/peco-application-snapshot";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  renderPecoCapPreparationDraft,
  renderPecoCapIncomePreparationPacket,
  pecoCapPreparationSnapshotSchema,
  type PecoCapDraftInput,
  type PecoCapPreparationSnapshot,
} from "../src/lib/parent/peco-cap-draft";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

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


// Offline official-form rehearsal only; never reads runtime secrets or sends a packet.
async function main() {
  const directory = resolve("tmp/parent-verification/peco-cap-drafts");
  mkdirSync(directory, { recursive: true });
  const template = readFileSync("tests/fixtures/parent/peco-cap-2026.pdf");
  const now = new Date("2026-10-26T12:00:00Z");
  const base: PecoCapDraftInput = {
    accountNumber: "9000000001",
    applicant: {
      firstName: "María",
      lastName: "Rivera",
      middleInitial: "L",
      dateOfBirth: "1988-04-15",
      incomeSource: "Employment",
    },
    address: {
      street: "123 Synthetic Way",
      apartment: "2B",
      city: "Philadelphia",
      state: "PA",
      zip: "19104",
    },
    homePhone: "215-555-0101",
    householdMembers: [],
  };
  const member = (index: number) => ({
    firstName: `Demo${index}`,
    lastName: "Rivera",
    dateOfBirth: `${index <= 5 ? 2010 + index : 1980 + index % 10}-06-09`,
    relationship: index <= 5 ? "Child" : index === 6 ? "Sibling" : "Relative",
    incomeSource: index <= 5 ? "None" : index === 6 ? "Employment" : "Self employed",
  });
  const cases: {
    name: string;
    input: PecoCapDraftInput;
    pages: number;
    packet?: { manifest: unknown; preparationSnapshot: PecoCapPreparationSnapshot; originals: { documentId: string; filename: string }[] };
    projection?: { manifest: unknown; sourceSnapshot: unknown; context: unknown; incomeProof: string; submissionReady: boolean };
  }[] = [
    { name: "peco-single", input: base, pages: 2 },
    {
      name: "peco-five",
      input: { ...base, householdMembers: Array.from({ length: 4 }, (_, i) => member(i + 1)) },
      pages: 2,
    },
    {
      name: "peco-overflow",
      input: {
        ...base,
        applicant: {
          ...base.applicant,
          firstName: "María Elena Antonia",
          lastName: "De la Cruz Montenegro",
          incomeSource: "Seasonal employment and pension",
        },
        cellPhone: "215-555-0100",
        smsUpdates: true,
        householdMembers: Array.from({ length: 28 }, (_, i) => member(i + 1)),
      },
      pages: 4,
    },
  ];
  for (const testCase of cases) {
    writeFileSync(
      resolve(directory, `${testCase.name}.pdf`),
      await renderPecoCapPreparationDraft(template, testCase.input, now),
    );
  }
  const proof = await PDFDocument.create();
  proof.setCreationDate(now);
  proof.setModificationDate(now);
  const font = await proof.embedFont(StandardFonts.Helvetica);
  const pixels = Buffer.alloc(24 * 24 * 3);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const color = (x < 12) === (y < 12) ? [39, 76, 119] : [228, 145, 65];
    pixels.set(color, (y * 24 + x) * 3);
  }
  const png = await sharp(pixels, { raw: { width: 24, height: 24, channels: 3 } }).png().toBuffer();
  const image = await proof.embedPng(png);
  for (let i = 1; i <= 2; i++) {
    const page = proof.addPage([612, 792]);
    page.drawText(`SYNTHETIC employer evidence ${i}`, { x: 30, y: 750, size: 14, font });
    page.drawText("Gross pay USD 2000.00 | September 27 - October 26, 2026", { x: 30, y: 720, size: 10, font });
    page.drawText("Employer verification: synthetic source only", { x: 30, y: 690, size: 10, font });
    page.drawText(`Original bottom edge ${i}`, { x: 10, y: 8, size: 8, font });
    page.drawImage(image, { x: 30, y: 560, width: 96, height: 96 });
    page.drawRectangle({ x: 2, y: 2, width: 608, height: 788, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
  }
  const original = await proof.save();
  const otherProof = await PDFDocument.create();
  otherProof.setCreationDate(now);
  otherProof.setModificationDate(now);
  const otherFont = await otherProof.embedFont(StandardFonts.Helvetica);
  const otherPage = otherProof.addPage([612, 792]);
  otherPage.drawText("SYNTHETIC second employer evidence", { x: 30, y: 750, size: 14, font: otherFont });
  otherPage.drawText("Gross pay USD 500.00 | September 27 - October 26, 2026", {
    x: 30,
    y: 720,
    size: 10,
    font: otherFont
  });
  otherPage.drawText("Independent original bottom edge", { x: 10, y: 8, size: 8, font: otherFont });
  otherPage.drawRectangle({ x: 2, y: 2, width: 608, height: 788, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
  const otherOriginal = await otherProof.save();
  const facts = income(original);
  for (const [documentId, sourceId, bytes] of [
    ["proof-2", "job-2", original], ["proof-3", "job-3", otherOriginal],
  ] as const) {
    facts.household.people[0].inventory!.sources.push({ sourceId, kind: "employment" });
    facts.documents.push({
      ...structuredClone(facts.documents[0]), documentId, sha256: hash(bytes), coverage: [{
        ...facts.documents[0].coverage[0], sourceId,
      }]
    });
    facts.scope.documentConsent!.documentIds.push(documentId);
    facts.bundles[0].documentIds.push(documentId);
    facts.bundles[0].sourceCoverage.push({
      ...structuredClone(facts.bundles[0].sourceCoverage[0]),
      sourceId, documentRefs: [{ documentId, sha256: hash(bytes) }],
    });
  }
  const preparationSnapshot = pecoCapPreparationSnapshotSchema.parse({
    id: "preparation-1", revision: 1, binding: facts.scope.binding,
    subjectIds: [facts.scope.applicantSubjectId], confirmedAt: facts.household.verifiedAt,
    validUntil: facts.household.validUntil, retentionUntil: facts.household.validUntil, details: base,
  });
  facts.scope.preparationSnapshot = {
    id: preparationSnapshot.id, revision: preparationSnapshot.revision, sha256: hash(JSON.stringify(preparationSnapshot)),
  };
  const packet = await renderPecoCapIncomePreparationPacket(template, preparationSnapshot, facts,
    [{ documentId: "proof-1", bytes: original }, { documentId: "proof-2", bytes: original },
    { documentId: "proof-3", bytes: otherOriginal }], now);
  writeFileSync(resolve(directory, "synthetic-income-original.pdf"), original);
  writeFileSync(resolve(directory, "synthetic-other-income-original.pdf"), otherOriginal);
  writeFileSync(resolve(directory, "peco-income-packet.pdf"), packet.bytes);
  cases.push({
    name: "peco-income-packet",
    input: base,
    pages: 5,
    packet: {
      manifest: packet.manifest,
      preparationSnapshot,
      originals: [
        { documentId: "proof-1", filename: "synthetic-income-original.pdf" },
        { documentId: "proof-2", filename: "synthetic-income-original.pdf" },
        { documentId: "proof-3", filename: "synthetic-other-income-original.pdf" },
      ],
    }
  });
  const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222";
  const actorId = "33333333-3333-4333-8333-333333333333", applicantId = "44444444-4444-4444-8444-444444444444", childId = "55555555-5555-4555-8555-555555555555";
  const privateDetails: PecoApplicationFields = { journey: "new_enrollment", currentCapState: "not_enrolled", householdComplete: true, accountNumber: base.accountNumber,
    applicant: { id: applicantId, firstName: base.applicant.firstName, lastName: base.applicant.lastName, dateOfBirth: base.applicant.dateOfBirth, income: { state: "none", sources: [] } },
    address: { ...base.address, state: "PA" }, householdMembers: [{ id: childId, firstName: "FictionalChild", lastName: "Rivera", dateOfBirth: "2020-01-01", relationship: "Child" }] };
  const snapshot = pecoApplicationSnapshotSchema.parse({ id: snapshotId, request_id: requestId, revision: 1, base_version: 1, request_version: 2, details: privateDetails,
    provenance: Object.fromEntries(Object.keys(pecoApplicationLeaves(privateDetails)).map(path => [path, { source: "parent", confirmedAt: "2026-11-13T20:07:00.000Z", asOf: "2026-11-13" }])),
    source: PECO_APPLICATION_SOURCE, notice_version: PECO_APPLICATION_NOTICE_VERSION, created_at: "2026-11-13T20:08:00.000Z", idempotency_key: childId,
    consent_evidence: { subjectAuthorityDeclared: true, subjectStatement: PECO_SUBJECT_AUTHORITY_STATEMENT, accountAuthorityDeclared: true, accountStatement: PECO_ACCOUNT_AUTHORITY_STATEMENT,
      accountAuthority: "self", actorId, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, declaredAt: "2026-11-13T20:08:00.000Z", revision: 1,
      detailsSha256: hash(JSON.stringify(privateDetails)), accountNumberSha256: hash(base.accountNumber), subjects: [`applicant.${applicantId}`, `householdMembers.${childId}`] } });
  const binding = { requestId, householdId: "88888888-8888-4888-8888-888888888888", requestVersion: 2, accountRef: snapshotId,
    programId: "peco-cap" as const, need: "electricity" as const, purpose: "income_preparation" as const };
  const deadline = "2026-11-14T20:00:00.000Z";
  const context: FictionalPecoPreparationContext = { kind: "fictional_offline_rehearsal", expectedSnapshot: { id: snapshot.id, revision: snapshot.revision, sha256: hash(JSON.stringify(snapshot)), binding }, binding,
    actorId, accountAuthority: "self", accountNumberSha256: snapshot.consent_evidence.accountNumberSha256, requestState: "active",
    mandate: { version: 1, mode: "prepare_only", recipientIds: ["peco-cap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"],
      expiresAt: deadline, maxAttempts: 12, maxRecipients: 1, bookingPreference: "ask_me", accepted: true }, mandateRevoked: false,
    grant: { expiresAt: deadline, revoked: false }, collection: { collectionEnabled: true, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, expiresAt: deadline }, validUntil: deadline, retentionUntil: deadline };
  const projection = await prepareFictionalPecoApplicationDraft(template, snapshot, context, new Date("2026-11-13T20:10:00Z"));
  if (!projection.bytes || !projection.manifest || !projection.formFieldsReady) throw new Error();
  writeFileSync(resolve(directory, "peco-private-projection.pdf"), projection.bytes);
  cases.push({ name: "peco-private-projection", pages: 2, input: { accountNumber: base.accountNumber,
    applicant: { firstName: base.applicant.firstName, lastName: base.applicant.lastName, dateOfBirth: base.applicant.dateOfBirth, incomeSource: "No income" },
    address: base.address, householdMembers: [{ firstName: "FictionalChild", lastName: "Rivera", dateOfBirth: "2020-01-01", relationship: "Child" }] },
    projection: { manifest: projection.manifest, sourceSnapshot: snapshot, context, incomeProof: projection.incomeProof, submissionReady: projection.submissionReady } });
  writeFileSync(resolve(directory, "cases.json"), JSON.stringify(cases, null, 2));
  execFileSync(process.env.CASELINK_PYTHON_BIN ?? "python3", [
    resolve("scripts/verify-peco-cap-pdfs.py"), directory,
  ], { stdio: "inherit" });
}

main().catch(() => {
  process.stderr.write("Offline PECO unsigned preparation verification failed.\n");
  process.exitCode = 1;
});
