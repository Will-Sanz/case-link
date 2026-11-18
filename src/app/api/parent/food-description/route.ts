import { z } from "zod";
import { authorizeFoodDescriptionCollection, foodDescriptionAvailable, getFoodDescriptionArchive, getFoodDescriptionResult, mutateFoodDescription } from "@/lib/parent/food-description-data";
import { FoodDescriptionError } from "@/lib/parent/food-description-draft";
import { parentError, parentJson, readParentJson, requireSameOrigin } from "@/lib/parent/http";
function failure(error: unknown) {
  if (error instanceof FoodDescriptionError) return parentJson({ ok: false, code: error.code }, error.status);
  if (error instanceof z.ZodError) return parentJson({ ok: false, code: "invalid" }, 400);
  return parentError(error);
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.has("draft")) return parentJson({ ok: true, result: await getFoodDescriptionResult(z.uuid().parse(url.searchParams.get("draft"))) });
    const archive = await getFoodDescriptionArchive();
    if (url.searchParams.get("download") === "1") return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), foodDescriptions: archive }, null, 2), {
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": 'attachment; filename="caselink-food-description.json"' },
    });
    return parentJson({ ok: true, archive });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    // Closed processing never reads a prose body. Exact acknowledgement/rights remain in GET.
    if (!await foodDescriptionAvailable()) return parentJson({ ok: false, code: "unavailable" }, 403);
    const draftId = new URL(request.url).searchParams.get("draft");
    await authorizeFoodDescriptionCollection(draftId);
    const body = await readParentJson(request, 4096);
    const action = body && typeof body === "object" && "action" in body ? body.action : null;
    if (action !== (draftId ? "queue" : "create") || (draftId && (!("draftId" in (body as object)) || (body as { draftId: unknown }).draftId !== draftId))) throw new FoodDescriptionError(400, "invalid");
    return parentJson({ ok: true, ...await mutateFoodDescription(body) });
  }
  catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const body = z.object({ action: z.literal("cancel"), expectedOwnerId: z.uuid(), draftId: z.uuid() }).strict().parse(await readParentJson(request, 512));
    return parentJson({ ok: true, ...await mutateFoodDescription(body) });
  } catch (error) { return failure(error); }
}
