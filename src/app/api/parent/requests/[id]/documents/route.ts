import { requireParentSession } from "@/lib/parent/auth";
import {
  deleteParentDocument,
  getSupportRequest,
  registerParentDocument,
  confirmParentDocumentUpload,
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
export async function GET(_: Request, { params }: Context) {
  try {
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
    const document = await registerParentDocument({
      requestId: id,
      filename: file.name,
      mediaType,
      pageCount: null,
      sizeBytes: file.size,
      consentVersion: DOCUMENT_CONSENT_VERSION,
    });
    const upload = await supabase.storage
      .from(PARENT_DOCUMENT_BUCKET)
      .upload(document.object_path, bytes, {
        contentType: mediaType,
        upsert: false,
      });
    if (upload.error) {
      await deleteParentDocument(id, document.id);
      throw upload.error;
    }
    try {
      await confirmParentDocumentUpload(id, document.id);
    } catch (error) {
      await deleteParentDocument(id, document.id);
      throw error;
    }
    const { object_path: _, ...safeDocument } = document;
    void _;
    return parentJson({ ok: true, document: safeDocument }, 201);
  } catch (error) {
    return parentError(error);
  }
}
