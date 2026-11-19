import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";

export type VerifiedFormContract = {
  programId: string;
  templateId: string;
  version: string;
  templateSha256: string;
  verifiedUntil: string;
  fields: Record<string, string>;
  requiredFields: string[];
  personalFields: string[];
};
export async function fillVerifiedForm(
  contract: VerifiedFormContract,
  template: Uint8Array,
  packet: Record<string, unknown>,
  now: Date,
): Promise<Uint8Array> {
  if (
    !Number.isFinite(Date.parse(contract.verifiedUntil)) ||
    Date.parse(contract.verifiedUntil) <= now.getTime()
  )
    throw new Error("The form version needs a current review.");
  if (
    createHash("sha256").update(template).digest("hex") !==
    contract.templateSha256
  )
    throw new Error("The form differs from its verified template.");
  const pdf = await PDFDocument.load(template, { updateMetadata: false });
  if (pdf.isEncrypted) throw new Error("Encrypted templates are unsupported.");
  const form = pdf.getForm();
  const names = form.getFields().map((field) => field.getName());
  if (Object.keys(contract.fields).some((name) => !names.includes(name)))
    throw new Error("The form fields differ from the verified version.");
  if (
    contract.requiredFields.some(
      (field) => packet[field] === undefined || packet[field] === null,
    )
  )
    throw new Error("A required form fact is missing.");
  for (const [field, key] of Object.entries(contract.fields)) {
    if (
      contract.personalFields.includes(field) ||
      /signature|attestation|certif(y|ication)|password|social.?security|\bssn\b/i.test(
        field,
      )
    )
      throw new Error("A personal declaration cannot be filled by the agent.");
    const value = packet[key];
    if (value === undefined || value === null) continue;
    if (!["string", "number"].includes(typeof value))
      throw new Error("The form field requires a validated text or number.");
    form.getTextField(field).setText(String(value));
  }
  // Keep personal fields editable for the parent's required act; retain the exact prepared version.
  return pdf.save();
}
