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

export async function GET() {
  try {
    return parentJson({ ok: true, requests: await listSupportRequests() });
  } catch (error) {
    return parentError(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const value = z
      .object({ intake: intakeSchema, mandate: mandateSchema })
      .strict()
      .parse(await readParentJson(request));
    if (validateMandate(value.mandate, new Date()))
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
    const id = await startSupportRequest(
      value.intake,
      value.mandate,
      idempotencyKey,
    );
    return parentJson({ ok: true, request: await getSupportRequest(id) }, 201);
  } catch (error) {
    return parentError(error);
  }
}
