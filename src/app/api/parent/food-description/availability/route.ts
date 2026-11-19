import { foodDescriptionAvailable } from "@/lib/parent/food-description-data";
import { parentJson } from "@/lib/parent/http";
/** Metadata only; this never creates an identity, draft, model call or permission. */
export async function GET() {
  try { return parentJson({ ok: true, available: await foodDescriptionAvailable() }); }
  catch { return parentJson({ ok: true, available: false }); }
}
