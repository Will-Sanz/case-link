import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { inspectStaticProof } from "./peco-cap-draft";
import { inspectDocument } from "./documents";
import { MAX_UTILITY_PREPARED_BYTES, type UtilityPreparedInputBinding } from "./utility-protected-operation";
import { withUtilityProtectedInput, readUtilityProtectedIncomeValidation, type UtilityProtectedApplicationContext, type UtilityProtectedOptions } from "./utility-protected-client";
import { type UtilityProtectedInputReference } from "./utility-protected-input-contract";
import { validateStoredUtilityIncomeProof } from "./utility-protected-preparation";
import { UTILITY_INCOME_PROOF_VERSION } from "./utility-income-proof";

const unavailable = () => new Error("The protected utility preparation needs a service check.");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Isolated preparation only. Copies are checked for safe rendering; their authenticity and proof completeness remain unconfirmed. */
export async function appendUtilityPreparationProofs(base: Uint8Array, context: UtilityProtectedApplicationContext, supplied: UtilityProtectedInputReference[], options: UtilityProtectedOptions) {
  const references = structuredClone(supplied).filter(ref => ref.purpose === "income_proof" || ref.purpose === "residency_proof");
  if (references.length > 256 || new Set(references.map(ref => ref.inputId)).size !== references.length || base.length > MAX_UTILITY_PREPARED_BYTES) throw unavailable();
  const output = await PDFDocument.load(Uint8Array.from(base), { updateMetadata: false }), font = await output.embedFont(StandardFonts.Helvetica);
  const inputs: UtilityPreparedInputBinding[] = [], deadlines: number[] = [], seen = new Set<string>();
  let originalBytes = base.length;
  for (const [index, initial] of references.entries()) {
    options.signal?.throwIfAborted();
    if (initial.ownerId !== context.ownerId || initial.requestId !== context.requestId || initial.requestVersion !== context.requestVersion || initial.programId !== context.programId ||
      initial.snapshotId !== context.snapshot.id || initial.snapshotRevision !== context.snapshot.revision || initial.snapshotHash !== context.snapshot.consent_evidence.detailsSha256 ||
      initial.state !== "stored" || Date.parse(initial.expiresAt) <= Date.now()) throw unavailable();
    const reference = initial.purpose === "income_proof" && initial.validation?.validatorVersion !== UTILITY_INCOME_PROOF_VERSION
      ? await validateStoredUtilityIncomeProof(initial.inputId, options) : initial;
    const validation = reference.purpose === "income_proof" ? await readUtilityProtectedIncomeValidation(reference.inputId, UTILITY_INCOME_PROOF_VERSION, options) : null;
    if (validation && reference.validation?.id !== validation.validationId) throw unavailable();
    await withUtilityProtectedInput(reference.inputId, options, async ({ binding, bytes, signal }) => {
      if (binding.authorizationId !== reference.authorizationId || binding.ownerId !== context.ownerId || binding.requestId !== context.requestId || binding.snapshotId !== context.snapshot.id ||
        binding.programId !== context.programId || binding.snapshotRevision !== context.snapshot.revision || binding.snapshotHash !== reference.snapshotHash || binding.requestVersion !== context.requestVersion || binding.purpose !== reference.purpose ||
        JSON.stringify(binding.targets) !== JSON.stringify(reference.targets) || validation && validation.projection.originalSha256 !== hash(bytes)) throw unavailable();
      originalBytes += bytes.length; if (originalBytes > MAX_UTILITY_PREPARED_BYTES) throw unavailable();
      const digest = hash(bytes);
      if (!seen.has(digest)) {
        const cover = output.addPage([612, 792]);
        const lines = ["PROTECTED UTILITY PREPARATION COPY - NOT SENT", `Supporting document ${index + 1}`,
          "Authenticity and complete programme proof are not established.", "Signatures and personal decisions remain unrecorded.",
          ...(validation ? [`Printed gross USD: ${(validation.projection.grossCents / 100).toFixed(2)}`,
            `Printed period: ${validation.projection.periodStart} to ${validation.projection.periodEnd}`,
            `Printed issue date: ${validation.projection.issuedOn}`, "These employment source fields were checked against this exact original."]
            : ["Residency copy: provider acceptance has not been checked."])];
        lines.forEach((line, position) => cover.drawText(line, { x: 36, y: 752 - position * 24, size: position === 0 ? 11 : 10, font }));
        if (binding.mediaType === "application/pdf") {
          const proof = await inspectStaticProof(bytes);
          for (const page of proof.getPages()) {
            const copy = output.addPage([612, 792]);
            copy.drawPage(await output.embedPage(page), { x: 24.48, y: 36, width: 563.04, height: 728.64 });
            copy.drawText("Protected supporting copy - preparation only", { x: 36, y: 775, size: 9, font });
          }
        } else {
          if (!["image/png", "image/jpeg"].includes(binding.mediaType)) throw unavailable();
          await inspectDocument(bytes, binding.mediaType);
          const image = binding.mediaType === "image/png" ? await output.embedPng(bytes) : await output.embedJpg(bytes);
          const size = image.scale(Math.min(540 / image.width, 700 / image.height));
          const page = output.addPage([612, 792]); page.drawImage(image, { x: (612 - size.width) / 2, y: (792 - size.height) / 2, ...size });
          page.drawText("Protected supporting copy - preparation only", { x: 36, y: 775, size: 9, font });
        }
        seen.add(digest);
      }
      signal?.throwIfAborted();
    });
    inputs.push({ inputId: reference.inputId, authorizationId: reference.authorizationId, validationId: validation?.validationId ?? null });
    deadlines.push(Date.parse(reference.expiresAt), ...(validation ? [Date.parse(validation.expiresAt)] : []));
  }
  options.signal?.throwIfAborted();
  const bytes = await output.save(); if (options.signal?.aborted || bytes.length > MAX_UTILITY_PREPARED_BYTES) { bytes.fill(0); throw unavailable(); }
  return { bytes, inputs, expiresAt: deadlines.length ? new Date(Math.min(...deadlines)).toISOString() : null };
}
