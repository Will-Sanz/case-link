import { z } from "zod";
import { getSnapCaptureProgress, replaceSnapPersonalPages } from "@/lib/parent/snap-capture-progress-data";
import { snapCaptureProgressQuery, snapReplacePersonalPagesSchema } from "@/lib/parent/snap-capture-progress";
import { parentError, parentJson, readParentJson, requireSameOrigin, uuidSchema } from "@/lib/parent/http";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    if (request.headers.has("origin")) requireSameOrigin(request);
    if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) throw new Error("parent_origin_denied");
    const id = uuidSchema.parse((await params).id);
    return parentJson({ ok: true, capture: await getSnapCaptureProgress(id, snapCaptureProgressQuery(new URL(request.url))) });
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await params).id);
    if (new URL(request.url).search) throw new Error("parent_invalid_input");
    const input = snapReplacePersonalPagesSchema.parse(await readParentJson(request, 256));
    return parentJson({ ok: true, requestVersion: await replaceSnapPersonalPages(id, input) });
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
