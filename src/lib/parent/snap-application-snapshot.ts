import { z } from "zod";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { SNAP_APPLICATION_SOURCE, snapApplicationFieldsValueSchema, assessSnapApplicationFields } from "./snap-application-fields";

export const SNAP_PREVIEW_TEMPLATE_ID = "pa-snap-pa600fs-sg-2019-preview";
export const SNAP_PREVIEW_TEMPLATE_VERSION = "application-preview-2026-11-03.v1";
const uuid = z.uuid();
export const snapApplicationSnapshotSchema = z.object({
  id: uuid, request_id: uuid, revision: z.number().int().positive(), base_version: z.number().int().positive(), request_version: z.number().int().positive(),
  details: snapApplicationFieldsValueSchema,
  provenance: z.record(z.string(), z.object({
    source: z.literal("parent"), confirmedAt: z.iso.datetime({ offset: true }), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  }).strict()),
  source: z.custom<typeof SNAP_APPLICATION_SOURCE>((value) =>
    !!value && typeof value === "object" && Object.keys(value).length === Object.keys(SNAP_APPLICATION_SOURCE).length &&
    Object.entries(SNAP_APPLICATION_SOURCE).every(([key, expected]) => (value as Record<string, unknown>)[key] === expected)),
  notice_version: z.literal(SNAP_APPLICATION_NOTICE_VERSION), created_at: z.iso.datetime({ offset: true }), idempotency_key: uuid,
  confirmed_paths: z.array(z.string().min(1).max(200)).max(2000).optional(),
}).strict();
export type SnapApplicationSnapshot = z.infer<typeof snapApplicationSnapshotSchema>;

/** Match the stored stable paths; IDs identify records and are not fresh factual answers. */
export function snapApplicationLeaves(value: unknown, path = ""): Record<string, unknown> {
  if (Array.isArray(value) && ["household", "income.entries"].includes(path))
    return Object.assign({}, ...value.map(row => snapApplicationLeaves(row, `${path}.${row.id}`)));
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.assign({}, ...Object.entries(value).filter(([key]) => key !== "id").map(([key, child]) =>
      snapApplicationLeaves(child, path ? `${path}.${key}` : key)));
  return { [path]: value };
}

export function assessSnapApplicationSnapshot(input: unknown, now: Date) {
  const parsed = snapApplicationSnapshotSchema.safeParse(input);
  if (!parsed.success) throw new Error("snap_snapshot_invalid");
  const snapshot = parsed.data;
  const assessment = assessSnapApplicationFields(snapshot.details, now);
  const paths = Object.keys(snapApplicationLeaves(snapshot.details));
  if (paths.length !== Object.keys(snapshot.provenance).length || paths.some(path => !Object.hasOwn(snapshot.provenance, path)))
    throw new Error("snap_provenance_invalid");
  const stale: string[] = [];
  for (const path of paths) {
    const evidence = snapshot.provenance[path], confirmed = Date.parse(evidence.confirmedAt), asOf = Date.parse(evidence.asOf);
    if (!Number.isFinite(asOf) || new Date(`${evidence.asOf}T12:00:00Z`).toISOString().slice(0, 10) !== evidence.asOf ||
      asOf > confirmed || confirmed > now.getTime() || confirmed > Date.parse(snapshot.created_at) ||
      (path.startsWith("income.") && evidence.period !== snapshot.details.income?.month))
      throw new Error("snap_provenance_invalid");
    // Keep the existing 45-day evidence ceiling; reading or reauthorizing does not renew an answer.
    const computed = path === "householdSize" || path === `household.${snapshot.details.household?.[0]?.id}.relationship`;
    if (!computed && (confirmed < now.getTime() - 45 * 86400000 || asOf < now.getTime() - 45 * 86400000)) stale.push(path);
  }
  const invalidCurrentFields = [...new Set([...assessment.invalidCurrentFields, ...stale])];
  return { snapshot, readiness: { ...assessment, invalidCurrentFields, staleFields: stale,
    nonProtectedDataReadyForReview: assessment.nonProtectedDataReadyForReview && !stale.length } };
}
