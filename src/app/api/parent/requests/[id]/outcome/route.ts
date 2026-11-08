import { reportParentOutcome, closeParentRequest } from "@/lib/parent/activity";
import {
  parentError,
  parentJson,
  readParentJson,
  requireSameOrigin,
  uuidSchema,
} from "@/lib/parent/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await params).id);
    const value = (await readParentJson(request)) as Record<string, unknown>;
    if (value?.action === "close") {
      const { action: _, ...input } = value;
      void _;
      await closeParentRequest(id, input);
    } else await reportParentOutcome(id, value);
    return parentJson({ ok: true });
  } catch (error) {
    return parentError(error);
  }
}
