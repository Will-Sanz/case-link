import { z } from "zod";
import { getWicApplicationDetails, saveWicApplicationDetails, wicApplicationWriteSchema } from "@/lib/parent/wic-application-data";
import { parentError, parentJson, readParentJson, requireSameOrigin, uuidSchema } from "@/lib/parent/http";
import { getParentAuthorizationWindow } from "@/lib/parent/authorization-window";
import { getSupportRequest } from "@/lib/parent/data";
import { currentIntakeFields } from "@/lib/parent/current-intake-fields";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const id = uuidSchema.parse((await params).id);
    const revision = z.uuid().optional().parse(new URL(request.url).searchParams.get("revision") ?? undefined);
    const snapshot = await getWicApplicationDetails(id, revision);
    if (!snapshot) return parentJson({ ok: false, error: "This saved application is unavailable." }, 404);
    const supportRequest = await getSupportRequest(id);
    if (!supportRequest) return parentJson({ ok: false, error: "This saved application is unavailable." }, 404);
    return parentJson({ ok: true, snapshot, routingContext: {
      label: "Household routing ZIP only; this does not establish the contact's postal address.",
      zip: currentIntakeFields(supportRequest, new Date(), "wic_new").zip ?? null,
    } });
  } catch (error) {
    return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await params).id);
    const authorization = await getParentAuthorizationWindow();
    if (!authorization.wicApplication?.collectionEnabled)
      throw new Error("This request is unavailable, or its permission has changed.");
    const value = wicApplicationWriteSchema.parse(await readParentJson(request, 32768));
    const key = uuidSchema.parse(request.headers.get("idempotency-key"));
    const snapshotId = await saveWicApplicationDetails(id, value, key);
    return parentJson({ ok: true, snapshotId }, 201);
  } catch (error) {
    return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error);
  }
}
