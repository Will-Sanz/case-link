import { z } from "zod";
import type { ParentDocument, SupportRequest } from "./domain";
import { DOCUMENT_CONSENT_VERSION } from "./constants";

export const documentUploadKeySchema = z.uuid().transform(value => value.toLowerCase());
export const documentUploadReceiptSchema = z.object({
  state: z.enum(["pending", "confirmed", "expired", "removed"]),
  document: z.object({
    id: z.uuid(), request_id: z.uuid(), filename: z.string().min(1).max(200),
    media_type: z.enum(["application/pdf", "image/jpeg", "image/png"]), size_bytes: z.number().int().min(1).max(10485760),
    status: z.string().min(1).max(40), expires_at: z.iso.datetime({ offset: true }), created_at: z.iso.datetime({ offset: true }),
    upload_confirmed_at: z.iso.datetime({ offset: true }).nullable(), upload_key: documentUploadKeySchema,
  }).strict(),
}).strict();
export type DocumentUploadReceipt = z.infer<typeof documentUploadReceiptSchema>;
export const documentUploadRecordSchema = documentUploadReceiptSchema.shape.document.extend({
  upload_key: documentUploadKeySchema.nullable(),
  object_path: z.string().min(1).max(1000), upload_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  consent_version: z.literal(DOCUMENT_CONSENT_VERSION), consented_at: z.iso.datetime({ offset: true }),
}).passthrough();
export type DocumentUploadRecord = z.infer<typeof documentUploadRecordSchema>;
export const documentUploadRegistrationSchema = z.object({ document: documentUploadRecordSchema.extend({
  upload_key: documentUploadKeySchema, upload_sha256: z.string().regex(/^[0-9a-f]{64}$/),
}), existing: z.boolean() }).strict();

/** The hash identifies HTTP attempt bytes, not verified Storage content; only owned display metadata crosses the web boundary. */
export function documentUploadReceipt(record: DocumentUploadRecord, now = new Date()): DocumentUploadReceipt {
  const { id, request_id, filename, media_type, size_bytes, status, expires_at, created_at, upload_confirmed_at, upload_key } = record;
  return documentUploadReceiptSchema.parse({
    state: ["deleted", "deletion_pending", "raw_deleted"].includes(status) ? "removed"
      : Date.parse(expires_at) <= now.getTime() ? "expired" : upload_confirmed_at ? "confirmed" : "pending",
    document: { id, request_id, filename, media_type, size_bytes, status, expires_at, created_at, upload_confirmed_at, upload_key: upload_key ?? id },
  });
}
export function pendingDocumentUpload(document: ParentDocument): boolean {
  return document.upload_confirmed_at === null &&
    !["deleted", "deletion_pending", "raw_deleted"].includes(document.status);
}

/** Both upload and confirmation keep the existing ordinary/private document boundary. */
export function documentCaptureError(request: Pick<SupportRequest, "status" | "intake" | "has_peco_application_details" | "has_pgw_application_details" | "has_water_application_details">): string | null {
  if (!["active", "paused"].includes(request.status)) return "This request is unavailable, or its permission has changed.";
  if (request.intake.needs.every(need => need === "wic_new" || need === "wic_continuing")) return "WIC document processing is not available. Use official WIC help; your saved history remains available.";
  if (request.has_peco_application_details) return "Private PECO document processing is not available. Your saved history remains available.";
  if (request.has_pgw_application_details || request.has_water_application_details) return "Use this request's protected utility document path. Your saved history remains available.";
  return null;
}
