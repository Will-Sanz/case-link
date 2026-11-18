import { createHash } from "node:crypto";
import { documentCaptureError, documentUploadKeySchema, documentUploadReceipt } from "@/lib/parent/document-upload";
import { requireParentSession } from "@/lib/parent/auth";
import {
  getSupportRequest,
  registerParentDocument,
  confirmParentDocumentUpload,
  getParentDocumentUpload,
  tryConfirmParentDocumentUpload,
  PARENT_DOCUMENT_BUCKET,
} from "@/lib/parent/data";
import {
  DOCUMENT_CONSENT_VERSION,
  MAX_DOCUMENT_BYTES,
} from "@/lib/parent/constants";
import { checkUploadHeader } from "@/lib/parent/upload";
import {
  parentError,
  parentJson,
  readBoundedBody,
  requireSameOrigin,
  uuidSchema,
} from "@/lib/parent/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(input: Request, { params }: Context) {
  try {
    const id = uuidSchema.parse((await params).id), key = new URL(input.url).searchParams.get("uploadKey");
    if (key !== null) {
      const document = await getParentDocumentUpload(id, documentUploadKeySchema.parse(key));
      return document ? parentJson({ ok: true, receipt: documentUploadReceipt(document) })
        : parentJson({ ok: false, error: "This upload is unavailable." }, 404);
    }
    const request = await getSupportRequest(
      uuidSchema.parse((await params).id),
    );
    return request
      ? parentJson({ ok: true, documents: request.documents ?? [] })
      : parentJson(
          { ok: false, error: "This support request is unavailable." },
          404,
        );
  } catch (error) {
    return parentError(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await params).id);
    const { supabase } = await requireParentSession();
    const support = await getSupportRequest(id);
    if (!support) return parentJson({ ok: false, error: "This support request is unavailable." }, 404);
    const issue = documentCaptureError(support);
    if (issue) return parentJson({ ok: false, error: issue }, 403);
    const attemptKey = documentUploadKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!attemptKey.success) return parentJson({ ok: false, error: "Reload this page and check your document list before trying another upload." }, 400);
    const uploadKey = attemptKey.data;
    if (
      Number(request.headers.get("content-length") ?? 0) >
      MAX_DOCUMENT_BYTES + 32768
    )
      return parentJson(
        { ok: false, error: "Choose a file up to 10 MB." },
        413,
      );
    const body = await readBoundedBody(request, MAX_DOCUMENT_BYTES + 32768);
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      body: body as BodyInit,
    }).formData();
    if (form.get("consent") !== "1")
      return parentJson(
        {
          ok: false,
          error:
            "Read and accept document processing before adding a document. Manual entry is always available.",
        },
        400,
      );
    const file = form.get("file");
    if (!(file instanceof File) || file.size > MAX_DOCUMENT_BYTES)
      return parentJson(
        { ok: false, error: "Choose a JPEG, PNG or readable PDF up to 10 MB." },
        400,
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mediaType;
    try {
      mediaType = checkUploadHeader(bytes, file.type);
    } catch {
      return parentJson(
        {
          ok: false,
          error:
            "We couldn't read this file safely. Use a plain JPEG, PNG or unencrypted PDF with up to five pages, or enter information manually.",
        },
        400,
      );
    }
    const registration = await registerParentDocument({
      requestId: id, filename: file.name, mediaType, pageCount: null, sizeBytes: file.size,
      consentVersion: DOCUMENT_CONSENT_VERSION, uploadKey,
      uploadSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const document = registration.document;
    const result = async (failure?: unknown) => {
      const latest = await getParentDocumentUpload(id, uploadKey);
      if (!latest) throw new Error("This request is unavailable, or its permission has changed.");
      const receipt = documentUploadReceipt(latest);
      if (receipt.state === "confirmed") return parentJson({ ok: true, receipt, document: receipt.document }, 201);
      if (receipt.state === "expired" || receipt.state === "removed")
        return parentJson({ ok: false, error: "This upload expired or was removed. Choose the file again only if it is still needed.", receipt }, 410);
      if (failure instanceof Error && failure.message.startsWith("This request is unavailable")) return parentError(failure);
      return parentJson({ ok: false, error: "The upload result is not confirmed. Check its status before sending another copy.", receipt }, 503);
    };
    const initial = documentUploadReceipt(document);
    if (initial.state !== "pending") return result();
    if (registration.existing) {
      try { if (await tryConfirmParentDocumentUpload(id, document.id)) return result(); }
      catch (error) { return result(error); }
      const current = await getSupportRequest(id);
      if (!current) throw new Error("This request is unavailable, or its permission has changed.");
      const changed = documentCaptureError(current);
      if (changed) return parentJson({ ok: false, error: changed }, 403);
    }
    try {
      const upload = await supabase.storage.from(PARENT_DOCUMENT_BUCKET).upload(document.object_path, bytes, { contentType: mediaType, upsert: false });
      if (upload.error) throw upload.error;
      await confirmParentDocumentUpload(id, document.id);
    } catch (error) {
      // A failed acknowledgement may follow a successful immutable write. Reconcile before another copy or deletion.
      try { await tryConfirmParentDocumentUpload(id, document.id); }
      catch { /* The owned record below remains the source of truth; unknown outcomes retain their original quarantine. */ }
      return result(error);
    }
    return result();
  } catch (error) {
    if (error instanceof Error && error.message === "parent_document_upload_changed")
      return parentJson({ ok: false, error: "This file differs from the saved upload attempt. Check the existing upload before choosing another file." }, 409);
    return parentError(error);
  }
}
