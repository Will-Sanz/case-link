import { deleteParentDocument } from "@/lib/parent/data";
import {
  parentError,
  parentJson,
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
