import { z } from "zod";
import { pecoApplicationSnapshotSchema } from "./peco-application-snapshot";
import { pgwApplicationSnapshotSchema } from "./pgw-application-snapshot";
import { waterApplicationSnapshotSchema } from "./water-application-snapshot";
import { recordUtilityProtectedIncomeValidation, withUtilityProtectedInput, type UtilityProtectedOptions } from "./utility-protected-client";
import { utilityProtectedInputReferenceSchema, type UtilityProtectedBinding } from "./utility-protected-input-contract";
import { UTILITY_PROTECTED_INPUT_ERROR } from "./utility-protected-input";
import { validateUtilityIncomeProof, type UtilityIncomeProofContext } from "./utility-income-proof";

/** Resolve only the exact named employment source from a checked programme snapshot inside the isolated service. */
export function utilityIncomeProofContext(binding: UtilityProtectedBinding, input: unknown): UtilityIncomeProofContext {
  const snapshot = binding.programId === "peco-cap" ? pecoApplicationSnapshotSchema.parse(input)
    : binding.programId === "pgw-crp" ? pgwApplicationSnapshotSchema.parse(input) : waterApplicationSnapshotSchema.parse(input);
  if (binding.purpose !== "income_proof" || binding.targets.length !== 1 || snapshot.id !== binding.snapshotId || snapshot.revision !== binding.snapshotRevision ||
    snapshot.request_id !== binding.requestId || snapshot.request_version > binding.requestVersion || snapshot.consent_evidence.detailsSha256 !== binding.snapshotHash ||
    snapshot.consent_evidence.actorId !== binding.ownerId) throw new Error(UTILITY_PROTECTED_INPUT_ERROR);
  const target = binding.targets[0], details = snapshot.details;
  const people = [...("applicant" in details && details.applicant ? [details.applicant] : []),
    ...("customer" in details && details.customer ? [details.customer] : []), ...(details.householdMembers ?? [])];
  const person = people.find(person => person.id === target.subjectId);
  const source = person?.income?.sources.find(source => source.id === target.sourceId);
  if (!person || !source || source.kind !== "employment" || target.field !== "income") throw new Error(UTILITY_PROTECTED_INPUT_ERROR);
  const names = "name" in person ? [person.name] : "firstName" in person && "lastName" in person && person.firstName && person.lastName
    ? [`${person.firstName ?? ""} ${person.lastName ?? ""}`.trim(), ...("middleInitial" in person && person.middleInitial ? [`${person.firstName} ${person.middleInitial} ${person.lastName}`] : [])] : [];
  if (!names.length || names.some(name => typeof name !== "string" || !name.trim())) throw new Error(UTILITY_PROTECTED_INPUT_ERROR);
  return { programId: binding.programId, subjectId: target.subjectId, sourceId: z.uuid().parse(target.sourceId), subjectNames: names as string[], sourceKind: "employment" };
}

/** No browser-supplied projection or validation flag is accepted. Original consent expiry never advances. */
export async function validateStoredUtilityIncomeProof(inputId: string, options: UtilityProtectedOptions) {
  const checked = await withUtilityProtectedInput(inputId, options, async ({ binding, snapshot, bytes, signal }) => {
    const context = utilityIncomeProofContext(binding, snapshot);
    const result = await validateUtilityIncomeProof({ bytes, mediaType: binding.mediaType, context, now: new Date(), signal });
    if (result.status !== "source_fields_checked") throw new Error(UTILITY_PROTECTED_INPUT_ERROR);
    return { projection: result.projection, expiresAt: binding.expiresAt };
  });
  return utilityProtectedInputReferenceSchema.parse(await recordUtilityProtectedIncomeValidation(inputId, checked.projection, checked.expiresAt, options));
}
