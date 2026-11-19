import { z } from "zod";
import { getSnapCaptureContext } from "@/lib/parent/snap-capture-data";
import { snapCaptureQuery } from "@/lib/parent/snap-capture-context";
import { parentError, parentJson, requireSameOrigin, uuidSchema } from "@/lib/parent/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.has("origin")) requireSameOrigin(request);
    if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) throw new Error("parent_origin_denied");
    const id = uuidSchema.parse((await params).id);
    return parentJson({ ok: true, context: await getSnapCaptureContext(id, snapCaptureQuery(new URL(request.url))) });
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
