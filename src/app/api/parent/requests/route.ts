import { z } from "zod";
import { intakeSchema, mandateSchema } from "@/lib/parent/domain";
import {
  getSupportRequest,
  listSupportRequests,
  startSupportRequest,
} from "@/lib/parent/data";
import {
  parentError,
  parentJson,
  readParentJson,
  requireSameOrigin,
} from "@/lib/parent/http";
import { validateMandate } from "@/lib/parent/policy";
import { getProgramsForNeeds } from "@/lib/parent/programs";
import { getParentAuthorizationWindow } from "@/lib/parent/authorization-window";
import {
  getSupportProgress,
  listSupportProgress,
} from "@/lib/parent/progress-data";
import { SNAP_APPLICATION_NOTICE_VERSION, startSnapApplication } from "@/lib/parent/snap-application-data";
import { snapApplicationFieldsValueSchema } from "@/lib/parent/snap-application-fields";

const startSchema = z.union([
  z.object({ intake: intakeSchema, mandate: mandateSchema }).strict(),
  z.object({ kind: z.literal("snap_application"), intake: intakeSchema, mandate: mandateSchema,
    details: snapApplicationFieldsValueSchema, noticeVersion: z.literal(SNAP_APPLICATION_NOTICE_VERSION) }).strict(),
]);

export async function GET() {
  try {
    const [requests, progress] = await Promise.all([
      listSupportRequests(),
      listSupportProgress(),
    ]);
    return parentJson({ ok: true, requests, progress });
  } catch (error) {
    return parentError(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const authorization = await getParentAuthorizationWindow();
    const input = await readParentJson(request, 65536);
    if (input && typeof input === "object" && "kind" in input && input.kind === "snap_application" &&
      !authorization.snapApplication?.collectionEnabled)
      throw new Error("This request is unavailable, or its permission has changed.");
    const value = startSchema.parse(input);
    if (validateMandate(value.mandate, new Date(authorization.issuedAt)))
      return parentJson(
        {
          ok: false,
          error:
            "Check the named programs and permission expiry, then start again.",
        },
        400,
      );
    const relevant = getProgramsForNeeds(value.intake.needs).map((p) => p.id);
    if (value.mandate.recipientIds.some((id) => !relevant.includes(id)))
      return parentJson(
        {
          ok: false,
          error: "Choose programs relevant to your support request.",
        },
        400,
      );
    const idempotencyKey = z
      .uuid()
      .parse(request.headers.get("idempotency-key"));
    const id = "kind" in value
      ? await startSnapApplication(value.intake, value.mandate, value.details, value.noticeVersion, idempotencyKey)
      : await startSupportRequest(value.intake, value.mandate, idempotencyKey);
    const [supportRequest, progress] = await Promise.all([
      getSupportRequest(id),
      getSupportProgress(id),
    ]);
    return parentJson({ ok: true, request: supportRequest, progress }, 201);
  } catch (error) {
    return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error);
  }
}
