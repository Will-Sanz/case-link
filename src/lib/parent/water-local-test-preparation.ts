import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { z } from "zod";
import { mandateSchema } from "./domain";
import { assessWaterApplicationFields, waterApplicationFieldsValueSchema } from "./water-application-fields";
import { waterApplicationSnapshotSchema } from "./water-application-snapshot";
import { isUtilityPreparationMandate } from "./utility-preparation-scope";
import { utilityProtectedContextSchema, withUtilityProtectedInput } from "./utility-protected-client";
import { utilityProtectedInputReferenceSchema, utilityProtectedScalarSchema } from "./utility-protected-input-contract";
import { appendUtilityPreparationProofs } from "./utility-preparation-pdf";
import type { UtilityPreparedRenderer } from "./utility-prepared-artifact-client";
import { MAX_UTILITY_PREPARED_BYTES } from "./utility-protected-operation";

export const WATER_LOCAL_TEST_SOURCE = { kind: "local_test_issued_form", id: "caselink-local-water-issued-form", version: "local-test-v1",
  sha256: "e58214635a6090640c674102876354c855b6cbad536c0cea479d8d55c62377fc", byteLength: 1300, rendererVersion: "local-water-test-v1" } as const;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const unavailable = () => new Error("The local test water preparation needs a service check.");
const valuesSchema = z.object({ access: utilityProtectedScalarSchema, recovery: utilityProtectedScalarSchema.optional() }).strict();
type LocalValues = z.infer<typeof valuesSchema>;

/** Deterministic local-test formatter only. The isolated factory establishes bindings; this is never a City form resolver. */
export async function renderWaterLocalTestDraft(template: Uint8Array, input: unknown, privateValues: LocalValues, now: Date) {
  try {
    const at = new Date(now), source = Uint8Array.from(template), fields = waterApplicationFieldsValueSchema.parse(structuredClone(input));
    const values = valuesSchema.parse(structuredClone(privateValues)), assessment = assessWaterApplicationFields(fields, at);
    if (hash(source) !== WATER_LOCAL_TEST_SOURCE.sha256 || source.length !== WATER_LOCAL_TEST_SOURCE.byteLength || values.access.purpose !== "account_access" ||
      values.recovery && values.recovery.purpose !== "application_recovery") throw unavailable();
    if (!assessment.referenceFieldsPresent || (fields.existingApplication === "saved" || fields.existingApplication === "submitted" || fields.journey === "pending") && !values.recovery) return null;
    const original = await PDFDocument.load(source, { updateMetadata: false }), pdf = await PDFDocument.create();
    pdf.setCreationDate(at); pdf.setModificationDate(at); pdf.setTitle("CaseLink LOCAL TEST WATER - not a City application");
    const font = await pdf.embedFont(StandardFonts.Helvetica), sourcePage = await pdf.embedPage(original.getPage(0));
    let page: PDFPage = pdf.addPage([612, 792]), y = 630; page.drawPage(sourcePage);
    const line = (label: string, value: unknown) => {
      const text = `${label}: ${value === undefined ? "Not provided" : String(value)}`;
      font.encodeText(text); const lines: string[] = []; let current = "";
      for (const word of text.split(" ")) {
        if (font.widthOfTextAtSize(word, 9) > 540) throw unavailable();
        const next = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(next, 9) > 540) { lines.push(current); current = word; } else current = next;
      }
      lines.push(current);
      for (const value of lines) {
        if (y < 52) { page = pdf.addPage([612, 792]); page.drawPage(sourcePage); y = 630; }
        page.drawText(value, { x: 36, y, size: 9, font }); y -= 15;
      }
      y -= 5;
    };
    line("Journey supplied", fields.journey); line("Existing application supplied", fields.existingApplication);
    line("Preferred channel supplied", fields.preferredChannel);
    line("Protected access code - local test only", values.access.accessCode); line("Protected access ZIP", values.access.zip);
    if (values.recovery?.purpose === "application_recovery") line("Supplied application ID - agency/account match unverified", values.recovery.applicationId);
    line("Property address", fields.propertyAddress); line("Mailing address", fields.mailingAddress); line("Phone", fields.phone); line("Email", fields.email);
    for (const [index, person] of [fields.applicant!, ...(fields.householdMembers ?? [])].entries()) {
      line(index === 0 ? "Applicant" : `Household member ${index}`, person.name); line("Date of birth", person.dateOfBirth);
      if ("relationship" in person) line("Relationship", person.relationship);
      line("Reported monthly gross USD", person.grossMonthlyIncome);
      line("Reported income inventory", person.income?.state === "none" ? "No sources reported" : person.income?.state === "unknown" ? "Not sure" : person.income?.sources.map(source => source.kind).join(", "));
      const reference = assessment.householdIncome.find(value => value.subjectId === person.id);
      if (reference?.basis === "sample_under_18_instruction") line("Reference-only amount", "0.00 from the other-member under-18 SAMPLE instruction; actual form unverified");
    }
    line("Household list declared complete", fields.householdComplete); line("OOPA answer", fields.oopa);
    line("Child support received", fields.childSupportReceived); line("Child support monthly USD", fields.childSupportMonthlyAmount);
    line("Outside household support", fields.outsideIncomeSupport);
    for (const supporter of fields.outsideSupporters ?? []) {
      line("Outside supporter", supporter.name); line("Supporter address", supporter.address); line("Supporter phone", supporter.phone);
      line("Supporter relationship", supporter.relationship); line("Support amount USD", supporter.amount); line("Support frequency", supporter.frequency);
      line("Other frequency description", supporter.frequencyDescription); line("Still providing support", supporter.stillProviding);
    }
    for (const [key, value] of Object.entries(fields.livingExpenses ?? {})) line(`Applicant zero-income explanation - ${key}`, value);
    line("Personal signatures / financial assent", "Not recorded"); line("Actual issued City form / provider acceptance / submission", "Unverified; no action occurred");
    return await pdf.save();
  } catch { throw unavailable(); }
}

/** Synthetic localhost test configuration only; no actual account-issued City form has been verified. */
export function createWaterLocalTestPreparationRenderer(template: Uint8Array): UtilityPreparedRenderer {
  const source = Uint8Array.from(template);
  return async input => {
    let base: Uint8Array | undefined, copied: Uint8Array | undefined, result: Uint8Array | undefined;
    const values: Partial<LocalValues> = {};
    try {
      const context = utilityProtectedContextSchema.parse(structuredClone(input.context)), snapshot = waterApplicationSnapshotSchema.parse(context.snapshot);
      const mandate = mandateSchema.parse(context.mandate), references = z.array(utilityProtectedInputReferenceSchema).max(256).parse(structuredClone(input.references));
      const options = input.options, now = new Date(), expectedSnapshot = hash(JSON.stringify(snapshot));
      const deadlines = [context.sourceExpiresAt, context.approvalExpiresAt, context.grantExpiresAt, mandate.expiresAt, snapshot.source.verifiedUntil].map(Date.parse);
      if (context.programId !== "pwd-tap" || context.need !== "water" || !isUtilityPreparationMandate(mandate, "pwd-tap") || snapshot.request_id !== context.requestId ||
        snapshot.request_version > context.requestVersion || snapshot.consent_evidence.actorId !== context.ownerId || snapshot.consent_evidence.accountAuthority !== context.accountAuthority ||
        Date.parse(snapshot.created_at) > now.getTime() || now.getTime() < Date.parse(snapshot.source.sourceCheckedAt) ||
        !Number.isFinite(Math.min(...deadlines)) || Math.min(...deadlines) <= now.getTime() ||
        hash(source) !== WATER_LOCAL_TEST_SOURCE.sha256 || source.length !== WATER_LOCAL_TEST_SOURCE.byteLength ||
        new Set(references.map(reference => reference.inputId)).size !== references.length) throw unavailable();
      for (const reference of references) if (reference.ownerId !== context.ownerId || reference.requestId !== context.requestId || reference.requestVersion !== context.requestVersion ||
        reference.programId !== "pwd-tap" || reference.snapshotId !== snapshot.id || reference.snapshotRevision !== snapshot.revision || reference.snapshotHash !== snapshot.consent_evidence.detailsSha256 ||
        reference.state !== "stored" || reference.purpose === "required_identifier" || Date.parse(reference.expiresAt) <= now.getTime()) throw unavailable();
      const scalars = references.filter(reference => reference.purpose === "account_access" || reference.purpose === "application_recovery");
      if (scalars.some(reference => reference.targets.length !== 1 || reference.targets[0].subjectId !== snapshot.details.applicant?.id || reference.targets[0].sourceId !== null ||
        reference.targets[0].field !== (reference.purpose === "account_access" ? "water_access_code" : "water_application_recovery") || reference.validation !== null) ||
        new Set(scalars.map(reference => reference.purpose)).size !== scalars.length) throw unavailable();
      const access = scalars.find(reference => reference.purpose === "account_access"), recovery = scalars.find(reference => reference.purpose === "application_recovery");
      const needsRecovery = snapshot.details.existingApplication === "saved" || snapshot.details.existingApplication === "submitted" || snapshot.details.journey === "pending";
      if (!access?.accountReference || needsRecovery && !recovery || !assessWaterApplicationFields(snapshot.details, now).referenceFieldsPresent) return null;
      if (recovery && !needsRecovery || references.some(reference => ["income_proof", "residency_proof"].includes(reference.purpose) && reference.accountReference !== access.accountReference)) throw unavailable();
      for (const reference of scalars) {
        const value = await withUtilityProtectedInput(reference.inputId, options, async ({ binding, snapshot: current, bytes, signal }) => {
          if (binding.authorizationId !== reference.authorizationId || binding.ownerId !== context.ownerId || binding.requestId !== context.requestId || binding.requestVersion !== context.requestVersion ||
            binding.programId !== "pwd-tap" || binding.need !== "water" || binding.purpose !== reference.purpose || binding.snapshotId !== snapshot.id || binding.snapshotRevision !== snapshot.revision ||
            binding.snapshotHash !== snapshot.consent_evidence.detailsSha256 || binding.mediaType !== "application/octet-stream" || JSON.stringify(binding.targets) !== JSON.stringify(reference.targets) ||
            binding.consentedAt !== reference.consentedAt || binding.expiresAt !== reference.expiresAt || hash(JSON.stringify(waterApplicationSnapshotSchema.parse(current))) !== expectedSnapshot) throw unavailable();
          signal?.throwIfAborted();
          const value = utilityProtectedScalarSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
          if (value.purpose !== reference.purpose) throw unavailable(); return value;
        });
        if (reference.purpose === "account_access") values.access = value; else values.recovery = value;
        deadlines.push(Date.parse(reference.expiresAt));
      }
      base = await renderWaterLocalTestDraft(source, snapshot.details, valuesSchema.parse(values), now) ?? undefined;
      if (!base) return null;
      const packet = await appendUtilityPreparationProofs(base, context, references, options); copied = packet.bytes;
      const pdf = await PDFDocument.load(copied, { updateMetadata: false }), font = await pdf.embedFont(StandardFonts.Helvetica);
      for (const page of pdf.getPages()) {
        page.drawRectangle({ x: 0, y: 0, width: 612, height: 28, color: rgb(.12, .15, .35) });
        page.drawText("CASELINK LOCAL TEST WATER - NOT A CITY APPLICATION - NOT SENT", { x: 36, y: 10, size: 9, font, color: rgb(1, 1, 1) });
      }
      result = await pdf.save(); if (result.length > MAX_UTILITY_PREPARED_BYTES) throw unavailable();
      if (packet.expiresAt) deadlines.push(Date.parse(packet.expiresAt));
      const expiry = Math.min(...deadlines); options.signal?.throwIfAborted(); if (expiry <= Date.now()) throw unavailable();
      const output = { bytes: result, source: { kind: WATER_LOCAL_TEST_SOURCE.kind, id: WATER_LOCAL_TEST_SOURCE.id, version: WATER_LOCAL_TEST_SOURCE.version,
        sha256: WATER_LOCAL_TEST_SOURCE.sha256, rendererVersion: WATER_LOCAL_TEST_SOURCE.rendererVersion }, expiresAt: new Date(expiry).toISOString(),
        inputs: [...scalars.map(reference => ({ inputId: reference.inputId, authorizationId: reference.authorizationId, validationId: null })), ...packet.inputs] };
      result = undefined; return output;
    } catch { throw unavailable(); }
    finally { base?.fill(0); copied?.fill(0); result?.fill(0); delete values.access; delete values.recovery; }
  };
}
