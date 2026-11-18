import { z } from "zod";
import { documentCaptureError, documentUploadKeySchema, documentUploadReceipt } from "@/lib/parent/document-upload";
import { deleteParentDocument, getParentDocumentUploadById, getSupportRequest, tryConfirmParentDocumentUpload } from "@/lib/parent/data";
import {
  parentError,
  parentJson,
  readParentJson,
  requireSameOrigin,
  uuidSchema,
} from "@/lib/parent/http";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    requireSameOrigin(request);
    const { id, documentId } = await params;
    await deleteParentDocument(
      uuidSchema.parse(id),
      uuidSchema.parse(documentId),
    );
    return parentJson({ ok: true });
  } catch (error) {
    return parentError(error);
  }
}

/** Finish only the already consented immutable upload; no file or new document is accepted here. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    requireSameOrigin(request);
    const { id, documentId } = await params;
    const requestId = uuidSchema.parse(id), document = uuidSchema.parse(documentId);
    const value = z.object({ uploadKey: documentUploadKeySchema.nullish() }).strict().parse(await readParentJson(request, 2000));
    const record = await getParentDocumentUploadById(requestId, document);
    if (!record || record.id.toLowerCase() !== document.toLowerCase() || (record.upload_key ? record.upload_key !== value.uploadKey : value.uploadKey != null && value.uploadKey !== record.id)) return parentJson({ ok: false, error: "This upload is unavailable." }, 404);
    const receipt = documentUploadReceipt(record);
    if (receipt.state === "confirmed") return parentJson({ ok: true, receipt });
    if (receipt.state !== "pending") return parentJson({ ok: false, error: "This upload expired or was removed. Choose the file again only if it is still needed.", receipt }, 410);
    const support = await getSupportRequest(requestId);
    if (!support) throw new Error("This request is unavailable, or its permission has changed.");
    const issue = documentCaptureError(support);
    if (issue) return parentJson({ ok: false, error: issue }, 403);
    const confirmed = await tryConfirmParentDocumentUpload(requestId, document);
    const latest = await getParentDocumentUploadById(requestId, document);
    if (!latest) throw new Error("This request is unavailable, or its permission has changed.");
    return parentJson({ ok: true, receipt: documentUploadReceipt(latest) }, confirmed ? 200 : 202);
  } catch (error) { return parentError(error); }
}
