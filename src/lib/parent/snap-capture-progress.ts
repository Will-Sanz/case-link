import { z } from "zod";

export const snapCaptureParentReasonSchema = z.enum(["page_1_unreadable", "page_5_unreadable", "applicant_identifier_needed", "personal_mark_or_date_needed", "facts_correction_needed"]);
export const snapCaptureServiceReasonSchema = z.enum(["check_unavailable", "provider_rule_unresolved"]);
const version = z.number().int().positive().max(2147483647);
const uuid = z.uuid().transform(value => value.toLowerCase());
export const snapCaptureProgressScopeSchema = z.object({ expectedVersion: version }).strict();
export const snapReplacePersonalPagesSchema = z.object({ expectedVersion: version.max(2147483646), previousPacketId: uuid }).strict();
const common = { packetId: uuid, requestVersion: version };
export const snapCaptureProgressSchema = z.discriminatedUnion("state", [
  z.object({ ...common, state: z.enum(["pending", "checked"]), reason: z.null() }).strict(),
  z.object({ ...common, state: z.literal("needs_parent"), reason: snapCaptureParentReasonSchema }).strict(),
  z.object({ ...common, state: z.literal("service_unavailable"), reason: snapCaptureServiceReasonSchema }).strict(),
  z.object({ ...common, state: z.literal("unavailable"), reason: z.literal("permission_or_file_unavailable") }).strict(),
]);
export type SnapCaptureProgress = z.infer<typeof snapCaptureProgressSchema>;

export function snapCaptureProgressQuery(url: URL) {
  const entries = [...url.searchParams];
  if (url.search.length > 64 || entries.length !== 1 || entries[0][0] !== "expectedVersion" || !/^[1-9][0-9]{0,9}$/.test(entries[0][1]))
    throw new Error("parent_invalid_input");
  return snapCaptureProgressScopeSchema.parse({ expectedVersion: Number(entries[0][1]) });
}
