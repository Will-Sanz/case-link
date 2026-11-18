import { createHash } from "node:crypto";
import { z } from "zod";
import { mandateSchema } from "./domain";
import { PGW_APPLICATION_SOURCE } from "./pgw-application-fields";
import { pgwApplicationSnapshotSchema } from "./pgw-application-snapshot";
import { assessPgwApplicationFields } from "./pgw-application-preparation";
import { renderOwnedPgwCrpDraft, type PgwProtectedIdentifier } from "./pgw-crp-draft";
import { isUtilityPreparationMandate } from "./utility-preparation-scope";
import { utilityProtectedContextSchema, withUtilityProtectedInput } from "./utility-protected-client";
import { utilityProtectedInputReferenceSchema, utilityProtectedScalarSchema } from "./utility-protected-input-contract";
import { appendUtilityPreparationProofs } from "./utility-preparation-pdf";
import type { UtilityPreparedRenderer } from "./utility-prepared-artifact-client";

const hash = (input: string | Uint8Array) => createHash("sha256").update(input).digest("hex");
const unavailable = () => new Error("The protected PGW preparation needs a service check.");

/** Isolated trusted context only. SQL resolves current ownership/authority and the worker rechecks its lease before sealing. */
export function createPgwUtilityPreparationRenderer(template: Uint8Array): UtilityPreparedRenderer {
  const source = Uint8Array.from(template);
  return async input => {
    let base: Uint8Array | undefined, result: Uint8Array | undefined;
    const identifiers: PgwProtectedIdentifier[] = [];
    try {
      // Snapshot caller-owned values before the first protected read. Digests bind data; they do not authenticate it.
      const context = utilityProtectedContextSchema.parse(structuredClone(input.context));
      const snapshot = pgwApplicationSnapshotSchema.parse(context.snapshot), mandate = mandateSchema.parse(context.mandate);
      const references = z.array(utilityProtectedInputReferenceSchema).max(256).parse(structuredClone(input.references));
      const options = input.options, now = new Date(), expectedSnapshot = hash(JSON.stringify(snapshot));
      const deadlines = [context.sourceExpiresAt, context.approvalExpiresAt, context.grantExpiresAt, mandate.expiresAt, snapshot.source.verifiedUntil].map(Date.parse);
      if (context.programId !== "pgw-crp" || context.need !== "gas" || !isUtilityPreparationMandate(mandate, "pgw-crp") ||
        snapshot.request_id !== context.requestId || snapshot.request_version > context.requestVersion || snapshot.consent_evidence.actorId !== context.ownerId ||
        snapshot.consent_evidence.accountAuthority !== context.accountAuthority || !snapshot.details.accountNumber ||
        hash(snapshot.details.accountNumber) !== snapshot.consent_evidence.accountNumberSha256 || Date.parse(snapshot.created_at) > now.getTime() ||
        now.getTime() < Date.parse(snapshot.source.sourceCheckedAt) || !Number.isFinite(Math.min(...deadlines)) || Math.min(...deadlines) <= now.getTime() ||
        source.length !== PGW_APPLICATION_SOURCE.sourceByteLength || hash(source) !== PGW_APPLICATION_SOURCE.sourceSha256 ||
        new Set(references.map(reference => reference.inputId)).size !== references.length) throw unavailable();
      for (const reference of references) {
        if (reference.ownerId !== context.ownerId || reference.requestId !== context.requestId || reference.requestVersion !== context.requestVersion ||
          reference.programId !== "pgw-crp" || reference.snapshotId !== snapshot.id || reference.snapshotRevision !== snapshot.revision ||
          reference.snapshotHash !== snapshot.consent_evidence.detailsSha256 || reference.state !== "stored" ||
          !["required_identifier", "income_proof"].includes(reference.purpose) || Date.parse(reference.expiresAt) <= now.getTime()) throw unavailable();
      }
      const assessment = assessPgwApplicationFields(snapshot.details, now);
      if (!assessment.formFieldsReady) return null;
      const required = references.filter(reference => reference.purpose === "required_identifier"), members = snapshot.details.householdMembers ?? [];
      if (required.some(reference => reference.validation !== null || reference.targets.length !== 1 || reference.targets[0].field !== "pgw_household_identifier" ||
        reference.targets[0].sourceId !== null || !members.some(member => member.id === reference.targets[0].subjectId)) ||
        new Set(required.map(reference => reference.targets[0].subjectId)).size !== required.length) throw unavailable();
      // Do not seal a packet that silently omits a source-required identifier. Existing private answers remain saved.
      if (members.some(member => !required.some(reference => reference.targets[0].subjectId === member.id))) return null;
      for (const reference of required) {
        const identifier = await withUtilityProtectedInput(reference.inputId, options, async ({ binding, snapshot: current, bytes, signal }) => {
          if (binding.authorizationId !== reference.authorizationId || binding.ownerId !== context.ownerId || binding.requestId !== context.requestId ||
            binding.requestVersion !== context.requestVersion || binding.programId !== "pgw-crp" || binding.need !== "gas" || binding.purpose !== "required_identifier" ||
            binding.snapshotId !== snapshot.id || binding.snapshotRevision !== snapshot.revision || binding.snapshotHash !== snapshot.consent_evidence.detailsSha256 ||
            binding.mediaType !== "application/octet-stream" || JSON.stringify(binding.targets) !== JSON.stringify(reference.targets) ||
            binding.consentedAt !== reference.consentedAt || binding.expiresAt !== reference.expiresAt ||
            hash(JSON.stringify(pgwApplicationSnapshotSchema.parse(current))) !== expectedSnapshot) throw unavailable();
          signal?.throwIfAborted();
          const value = utilityProtectedScalarSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
          if (value.purpose !== "required_identifier") throw unavailable();
          return { subjectId: reference.targets[0].subjectId, identifier: value };
        });
        identifiers.push(identifier); deadlines.push(Date.parse(reference.expiresAt));
      }
      const prepared = await renderOwnedPgwCrpDraft(source, snapshot.details, identifiers, now);
      if (!prepared.bytes) return null;
      base = prepared.bytes;
      const packet = await appendUtilityPreparationProofs(base, context, references, options);
      result = packet.bytes;
      if (packet.expiresAt) deadlines.push(Date.parse(packet.expiresAt));
      const expiry = Math.min(...deadlines);
      options.signal?.throwIfAborted();
      if (!Number.isFinite(expiry) || expiry <= Date.now()) throw unavailable();
      const output = { bytes: result, inputs: [...required.map(reference => ({ inputId: reference.inputId, authorizationId: reference.authorizationId, validationId: null })), ...packet.inputs],
        expiresAt: new Date(expiry).toISOString(), source: { kind: "official_public_form" as const, id: PGW_APPLICATION_SOURCE.id,
          version: PGW_APPLICATION_SOURCE.version, sha256: PGW_APPLICATION_SOURCE.sourceSha256, rendererVersion: "pgw-private-preparation-2026-11-13.v1" } };
      result = undefined; return output;
    } catch { throw unavailable(); }
    finally { base?.fill(0); result?.fill(0); identifiers.length = 0; }
  };
}
