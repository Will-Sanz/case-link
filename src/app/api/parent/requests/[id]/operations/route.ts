import { listRequestOperations } from "@/lib/parent/activity";
import { getSupportRequest } from "@/lib/parent/data";
import { parentError, parentJson, uuidSchema } from "@/lib/parent/http";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = uuidSchema.parse((await params).id);
    if (!(await getSupportRequest(id)))
      return parentJson(
        { ok: false, error: "This support request is unavailable." },
        404,
      );
    return parentJson({
      ok: true,
      operations: await listRequestOperations(id),
    });
  } catch (error) {
    return parentError(error);
  }
}
