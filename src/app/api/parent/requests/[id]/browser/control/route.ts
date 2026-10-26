import { applicationBrowserControl } from "@/lib/parent/browser-client";
import { browserControlSchema } from "@/lib/parent/browser-policy";
import {
  parentError,
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
    const input = browserControlSchema.parse(await readParentJson(request));
    return await applicationBrowserControl(
      uuidSchema.parse((await params).id),
      input,
    );
  } catch (error) {
    return parentError(error);
  }
}
