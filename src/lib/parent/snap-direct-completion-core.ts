import { z } from "zod";
import contract from "../../../data/verified-forms/snap-pa600fs-2019.json";
import { snapCaptureContextSchema } from "./snap-capture-context";
import { assessSnapApplicationSnapshot, snapApplicationSnapshotSchema } from "./snap-application-snapshot";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "./snap-protected-operation";
import { MAX_SNAP_PACKET_BYTES } from "./snap-packet-contract";

export const SNAP_DIRECT_COMPLETION_VERSION = "pa600fs-direct-completion-2026-11-05.v1";
const uuid = z.uuid().transform(value => value.toLowerCase()), hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime({ precision: 3 });
const point = z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) }).strict();
const stroke = z.array(point).min(2).max(512).refine(points => points.some(p => p.x !== points[0].x || p.y !== points[0].y));
const certification = z.object({
  actId: z.enum(SNAP_PARENT_CERTIFICATION_ACTS), provenance: z.literal("caller_reported_fresh_parent_drawing"),
  startedAt: instant, completedAt: instant, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  strokes: z.array(stroke).min(1).max(16).refine(strokes => strokes.reduce((count, points) => count + points.length, 0) <= 2048),
}).strict();
const trustedSchema = z.object({
  requestId: uuid, context: snapCaptureContextSchema, snapshot: snapApplicationSnapshotSchema,
  preparedAt: instant, unsignedContentSha256: hash,
}).strict();
const completionSchema = z.object({
  requestId: uuid, requestVersion: snapCaptureContextSchema.shape.requestVersion,
  snapshotId: uuid, snapshotHash: hash, source: snapCaptureContextSchema.shape.source, unsignedContentSha256: hash,
  signingRoute: z.enum(["applicant_name_handwriting", "mark_or_witness", "representative"]),
  identifiers: z.array(z.discriminatedUnion("kind", [
    z.object({ personId: uuid, kind: z.literal("ssn"), value: z.string().regex(/^\d{9}$/) }).strict(),
    z.object({ personId: uuid, kind: z.literal("provide_to_agency_later") }).strict(),
    z.object({ personId: uuid, kind: z.literal("unresolved_exception") }).strict(),
  ])).min(1).max(30),
  certifications: z.array(certification).length(2),
}).strict();
export type SnapDirectCompletionContext = z.input<typeof trustedSchema>;
export type SnapDirectCompletion = z.input<typeof completionSchema>;
type Reason = "invalid_completion" | "scope_changed" | "nonprotected_answers_unresolved" | "continuation_required"
  | "identifier_rule_unresolved" | "noncitizen_document_route_unresolved" | "personal_act_route_unresolved" | "unsupported_layout";
type Readiness = {
  kind: "closed_direct_completion_candidate"; rendererVersion: typeof SNAP_DIRECT_COMPLETION_VERSION;
  submissionReady: false; providerSignatureAcceptance: "unconfirmed"; identityOrSignatureVerified: false;
  personalActAttribution: "caller_reported_only";
};
const readiness: Readiness = { kind: "closed_direct_completion_candidate", rendererVersion: SNAP_DIRECT_COMPLETION_VERSION,
  submissionReady: false, providerSignatureAcceptance: "unconfirmed", identityOrSignatureVerified: false, personalActAttribution: "caller_reported_only" };
export type SnapDirectCompletionResult = { bytes: null; readiness: Readiness & { reason: Reason } } | {
  bytes: Uint8Array; contentSha256: string; byteLength: number;
  readiness: Readiness & { reason: null; requestId: string; context: z.infer<typeof snapCaptureContextSchema>;
    filingReadiness: "applicant_identifiers_provided" | "initial_filing_identifiers_outstanding"; outstandingIdentifierSubjectIds: string[];
    unsignedContentSha256: string; renderedPersonalActIds: typeof SNAP_PARENT_CERTIFICATION_ACTS };
};

const readinessSchema = z.object({
  kind: z.literal("closed_direct_completion_candidate"), rendererVersion: z.literal(SNAP_DIRECT_COMPLETION_VERSION),
  submissionReady: z.literal(false), providerSignatureAcceptance: z.literal("unconfirmed"), identityOrSignatureVerified: z.literal(false),
  personalActAttribution: z.literal("caller_reported_only"),
}).strict();
const reasonSchema = z.enum(["invalid_completion", "scope_changed", "nonprotected_answers_unresolved", "continuation_required",
  "identifier_rule_unresolved", "noncitizen_document_route_unresolved", "personal_act_route_unresolved", "unsupported_layout"]);
export const snapDirectCompletionResultSchema: z.ZodType<SnapDirectCompletionResult> = z.union([
  z.object({ bytes: z.null(), readiness: readinessSchema.extend({ reason: reasonSchema }).strict() }).strict(),
  z.object({
    bytes: z.instanceof(Uint8Array).refine(bytes => bytes.length > 0 && bytes.length <= MAX_SNAP_PACKET_BYTES),
    contentSha256: hash, byteLength: z.number().int().min(1).max(MAX_SNAP_PACKET_BYTES),
    readiness: readinessSchema.extend({ reason: z.null(), requestId: uuid, context: snapCaptureContextSchema,
      filingReadiness: z.enum(["applicant_identifiers_provided", "initial_filing_identifiers_outstanding"]),
      outstandingIdentifierSubjectIds: z.array(uuid).max(contract.limits.householdRows).refine(values => new Set(values).size === values.length),
      unsignedContentSha256: hash, renderedPersonalActIds: z.tuple([
        z.literal(SNAP_PARENT_CERTIFICATION_ACTS[0]), z.literal(SNAP_PARENT_CERTIFICATION_ACTS[1]),
      ]) }).strict().refine(value => value.outstandingIdentifierSubjectIds.every(id => value.context.applyingSubjectIds.includes(id))
        && (value.filingReadiness === "initial_filing_identifiers_outstanding") === (value.outstandingIdentifierSubjectIds.length > 0)),
  }).strict(),
]);
const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const snapDirectCompletionUnavailable = (reason: Reason): SnapDirectCompletionResult => ({ bytes: null, readiness: { ...readiness, reason } });
// Pinned printed fields, in original PDF points. No witness/representative area is filled.
export const SNAP_DIRECT_CERTIFICATION_REGIONS = {
  applicant_signature_printed_page_1: { page: 2, ink: [94, 55, 343, 70], date: [407, 55, 519, 70] },
  rights_certification_printed_page_5: { page: 6, ink: [33, 309, 259, 334], date: [270, 309, 341, 334] },
} as const;


/** Copies private input synchronously; a claimed scope is not database authority or proof of human origin. */
export function parseSnapDirectCompletionInputs(trustedInput: unknown, completionInput: unknown, now: Date) {
  const fail = (reason: Reason) => ({ ok: false as const, result: snapDirectCompletionUnavailable(reason) });
  try {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return fail("invalid_completion");
    const trusted = trustedSchema.parse(trustedInput), completion = completionSchema.parse(completionInput), context = trusted.context;
    // The snapshot's custom source schema does not clone this object.
    trusted.snapshot.source = { ...trusted.snapshot.source };
    const { snapshot, readiness: assessment } = assessSnapApplicationSnapshot(trusted.snapshot, now);
    const preparedAt = new Date(trusted.preparedAt);
    if (trusted.requestId !== snapshot.request_id.toLowerCase() || snapshot.id.toLowerCase() !== context.snapshotId
      || snapshot.request_version > context.requestVersion || Date.parse(snapshot.created_at) > preparedAt.getTime() || preparedAt > now
      || completion.requestId !== trusted.requestId || completion.requestVersion !== context.requestVersion || completion.snapshotId !== context.snapshotId
      || completion.snapshotHash !== context.snapshotHash || JSON.stringify(completion.source) !== JSON.stringify(context.source)
      || completion.unsignedContentSha256 !== trusted.unsignedContentSha256) return fail("scope_changed");
    const people = snapshot.details.household ?? [], applying = people.filter(person => person.requestingSnap);
    if ([...context.applyingSubjectIds].sort().join() !== applying.map(person => person.id.toLowerCase()).sort().join()) return fail("scope_changed");
    if (people.length > contract.limits.householdRows || (snapshot.details.income?.entries?.length ?? 0) > contract.limits.incomeRows)
      return fail("continuation_required");
    if (!assessment.nonProtectedDataReadyForReview) return fail("nonprotected_answers_unresolved");
    if (snapshot.details.authorizedRepresentative || completion.signingRoute !== "applicant_name_handwriting") return fail("personal_act_route_unresolved");
    if (applying.some(person => person.citizen === false)) return fail("noncitizen_document_route_unresolved");
    if (completion.identifiers.some(identifier => identifier.kind === "unresolved_exception")) return fail("identifier_rule_unresolved");
    if (new Set(completion.identifiers.map(identifier => identifier.personId)).size !== applying.length || completion.identifiers.length !== applying.length
      || completion.identifiers.some(identifier => !applying.some(person => person.id.toLowerCase() === identifier.personId))) return fail("scope_changed");
    const suppliedNumbers = completion.identifiers.flatMap(identifier => identifier.kind === "ssn" ? [identifier.value] : []);
    if (new Set(suppliedNumbers).size !== suppliedNumbers.length) return fail("identifier_rule_unresolved");
    if (new Set(completion.certifications.map(act => act.actId)).size !== SNAP_PARENT_CERTIFICATION_ACTS.length) return fail("invalid_completion");
    for (const act of completion.certifications) {
      const started = Date.parse(act.startedAt), completed = Date.parse(act.completedAt);
      if (started < preparedAt.getTime() || completed < started || completed > now.getTime() || act.date !== easternDay.format(new Date(completed)))
        return fail("invalid_completion");
    }
    return { ok: true as const, trusted, completion, snapshot, people, preparedAt };
  } catch { return fail("invalid_completion"); }
}

async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
}

/** An isolated server must independently regenerate the current signing copy; browser candidates remain untrusted. */
export async function completeSnapDirectCompletionCopy(unsignedInput: Uint8Array, trustedInput: unknown, completionInput: unknown, now: Date): Promise<SnapDirectCompletionResult> {
  let unsigned: Uint8Array<ArrayBuffer> | undefined, output: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (!(unsignedInput instanceof Uint8Array) || !unsignedInput.length || unsignedInput.length > MAX_SNAP_PACKET_BYTES)
      return snapDirectCompletionUnavailable("invalid_completion");
    const input = parseSnapDirectCompletionInputs(trustedInput, completionInput, now);
    if (!input.ok) return input.result;
    const { trusted, completion, people } = input, context = trusted.context;
    unsigned = Uint8Array.from(unsignedInput);
    if (await digest(unsigned) !== trusted.unsignedContentSha256) return snapDirectCompletionUnavailable("scope_changed");
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const document = await PDFDocument.load(unsigned, { updateMetadata: false, throwOnInvalidObject: true, capNumbers: true });
    const font = await document.embedFont(StandardFonts.Helvetica), first = document.getPage(2);
    for (const [row, person] of people.entries()) {
      if (!person.requestingSnap) continue;
      const identifier = completion.identifiers.find(value => value.personId === person.id.toLowerCase());
      if (!identifier) return snapDirectCompletionUnavailable("identifier_rule_unresolved");
      // A missing number does not block initial filing; never invent or print a substitute identifier.
      if (identifier.kind === "provide_to_agency_later") continue;
      if (identifier.kind !== "ssn") return snapDirectCompletionUnavailable("identifier_rule_unresolved");
      first.drawText(identifier.value, { x: 445, y: 309.5 - row * 23.4, size: 8, font, color: rgb(0, 0, 0) });
    }
    for (const act of completion.certifications) {
      const region = SNAP_DIRECT_CERTIFICATION_REGIONS[act.actId], page = document.getPage(region.page), [x0, y0, x1, y1] = region.ink;
      for (const points of act.strokes) for (let index = 1; index < points.length; index++) {
        const position = (p: z.infer<typeof point>) => ({ x: x0 + 1 + p.x * (x1 - x0 - 2), y: y0 + 1 + p.y * (y1 - y0 - 2) });
        page.drawLine({ start: position(points[index - 1]), end: position(points[index]), thickness: 1.2, color: rgb(0, 0, 0) });
      }
      const [dx0, dy0, dx1, dy1] = region.date, date = `${act.date.slice(5, 7)}/${act.date.slice(8)}/${act.date.slice(0, 4)}`;
      if (font.widthOfTextAtSize(date, 8) > dx1 - dx0 - 2) return snapDirectCompletionUnavailable("unsupported_layout");
      page.drawText(date, { x: dx0 + 1, y: dy0 + (dy1 - dy0 - 8) / 2, size: 8, font, color: rgb(0, 0, 0) });
    }
    document.setTitle("CaseLink SNAP direct-completion candidate");
    const outstandingIdentifierSubjectIds = completion.identifiers.filter(identifier => identifier.kind === "provide_to_agency_later").map(identifier => identifier.personId);
    document.setSubject("Closed candidate for exact private review; signature-method acceptance remains unconfirmed. Not sent."
      + (outstandingIdentifierSubjectIds.length ? " Initial filing: applicant identifiers remain to be provided to the agency." : ""));
    document.setKeywords([SNAP_DIRECT_COMPLETION_VERSION, "closed_direct_completion_candidate"]);
    output = Uint8Array.from(await document.save());
    if (!output.length || output.length > MAX_SNAP_PACKET_BYTES) return snapDirectCompletionUnavailable("unsupported_layout");
    const result: SnapDirectCompletionResult = { bytes: output, contentSha256: await digest(output), byteLength: output.length,
      readiness: { ...readiness, reason: null, requestId: trusted.requestId, context, unsignedContentSha256: trusted.unsignedContentSha256,
        filingReadiness: outstandingIdentifierSubjectIds.length ? "initial_filing_identifiers_outstanding" : "applicant_identifiers_provided", outstandingIdentifierSubjectIds,
        renderedPersonalActIds: [...SNAP_PARENT_CERTIFICATION_ACTS] } };
    output = undefined;
    return result;
  } catch { return snapDirectCompletionUnavailable("invalid_completion"); }
  finally { unsigned?.fill(0); output?.fill(0); }
}
