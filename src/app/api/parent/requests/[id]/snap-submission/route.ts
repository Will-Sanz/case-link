import { z } from "zod";
import { authorizeSnapSubmission, getSnapSubmissionReview, snapSubmissionDecisionSchema } from "@/lib/parent/snap-submission-data";
import { snapCaptureProgressQuery } from "@/lib/parent/snap-capture-progress";
import { parentError, parentJson, readParentJson, requireSameOrigin, uuidSchema } from "@/lib/parent/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.has("origin")) requireSameOrigin(request);
    if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) throw new Error("parent_origin_denied");
    const id = uuidSchema.parse((await params).id);
    return parentJson({ ok: true, review: await getSnapSubmissionReview(id, snapCaptureProgressQuery(new URL(request.url))) });
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await params).id);
    const value = snapSubmissionDecisionSchema.parse(await readParentJson(request, 2048));
    const operationId = await authorizeSnapSubmission(id, value);
    return parentJson({ ok: true, operationId, state: "authorization_recorded" }, 202);
  } catch (error) {
    if (error instanceof Error && error.message === "parent_snap_submission_not_ready")
      return parentJson({ ok: false, error: "CaseLink needs to resolve a submission issue. Refresh to check this application's latest status." }, 409);
    return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error);
  }
}
