import { applicationBrowser } from "@/lib/parent/browser-client";
import { parentError, uuidSchema } from "@/lib/parent/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const query = new URL(request.url).searchParams;
    if (
      [...query.keys()].some((key) => !["frameId", "view"].includes(key)) ||
      query.getAll("frameId").length > 1 ||
      query.getAll("view").length > 1 ||
      (query.has("view") && !/^\d{1,12}$/.test(query.get("view")!))
    )
      throw new Error("parent_invalid_input");
    const frameId = query.has("frameId")
      ? uuidSchema.parse(query.get("frameId"))
      : undefined;
    return await applicationBrowser(
      uuidSchema.parse((await params).id),
      "GET",
      true,
      frameId,
    );
  } catch (error) {
    return parentError(error);
  }
}
