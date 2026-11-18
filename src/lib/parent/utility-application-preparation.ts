import { createHash } from "node:crypto";
import { mandateSchema } from "./domain";
import { pecoApplicationSnapshotSchema } from "./peco-application-snapshot";
import { PECO_APPLICATION_NOTICE_VERSION, PECO_APPLICATION_SOURCE } from "./peco-application-fields";
import { prepareOwnedPecoApplicationDraft } from "./peco-application-preparation";
import { appendUtilityPreparationProofs } from "./utility-preparation-pdf";
import type { UtilityPreparedRenderer } from "./utility-prepared-artifact-client";
import { createPgwUtilityPreparationRenderer } from "./pgw-private-preparation";
import { UTILITY_PREPARATION_SOURCE_UNAVAILABLE } from "./utility-preparation-port";

/** These two checked public forms support private unsigned preparation; real City-issued water forms remain unavailable. */
export function createUtilityPreparationRenderer(templates: { peco: Uint8Array; pgw: Uint8Array }): UtilityPreparedRenderer {
  const peco = createPecoUtilityPreparationRenderer(templates.peco), pgw = createPgwUtilityPreparationRenderer(templates.pgw);
  return input => {
    if (input.context.programId === "peco-cap") return peco(input);
    if (input.context.programId === "pgw-crp") return pgw(input);
    throw new Error(UTILITY_PREPARATION_SOURCE_UNAVAILABLE);
  };
}

/** The isolated caller resolves current owner/mandate/source and rechecks its job lease before sealing any output. */
export function createPecoUtilityPreparationRenderer(template: Uint8Array): UtilityPreparedRenderer {
  const source = Uint8Array.from(template);
  return async ({ context, references, options }) => {
    if (context.programId !== "peco-cap" || context.need !== "electricity") throw new Error("The utility preparation source does not match.");
    const snapshot = pecoApplicationSnapshotSchema.parse(context.snapshot), mandate = mandateSchema.parse(context.mandate), now = new Date();
    const expiresAt = new Date(Math.min(...[context.sourceExpiresAt, context.approvalExpiresAt, context.grantExpiresAt, mandate.expiresAt].map(Date.parse))).toISOString();
    const binding = { requestId: context.requestId, householdId: context.householdId, requestVersion: context.requestVersion, accountRef: snapshot.id,
      programId: "peco-cap" as const, need: "electricity" as const, purpose: "income_preparation" as const };
    const prepared = await prepareOwnedPecoApplicationDraft(source, snapshot, {
      kind: "owned_private_preparation", expectedSnapshot: { id: snapshot.id, revision: snapshot.revision, sha256: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), binding }, binding,
      actorId: context.ownerId, accountAuthority: context.accountAuthority, accountNumberSha256: snapshot.consent_evidence.accountNumberSha256,
      requestState: "active", mandateRevoked: false, mandate, grant: { expiresAt: context.grantExpiresAt, revoked: false },
      collection: { collectionEnabled: true, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, expiresAt: context.approvalExpiresAt }, validUntil: expiresAt, retentionUntil: expiresAt,
    }, now);
    if (!prepared.bytes) return null;
    try {
      const packet = await appendUtilityPreparationProofs(prepared.bytes, context, references, options);
      return { bytes: packet.bytes, inputs: packet.inputs, expiresAt: new Date(Math.min(Date.parse(expiresAt), packet.expiresAt ? Date.parse(packet.expiresAt) : Infinity)).toISOString(),
        source: { kind: "official_public_form", id: PECO_APPLICATION_SOURCE.contractId, version: PECO_APPLICATION_SOURCE.contractVersion, sha256: PECO_APPLICATION_SOURCE.sourceSha256, rendererVersion: "peco-private-preparation-2026-11-13.v1" } };
    } finally { prepared.bytes.fill(0); }
  };
}
