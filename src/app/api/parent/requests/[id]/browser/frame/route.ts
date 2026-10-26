import { applicationBrowser } from "@/lib/parent/browser-client";
import { parentError, uuidSchema } from "@/lib/parent/http";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await applicationBrowser(
      uuidSchema.parse((await params).id),
      "GET",
      true,
    );
  } catch (error) {
    return parentError(error);
  }
}
