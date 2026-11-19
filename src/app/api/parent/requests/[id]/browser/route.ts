import { applicationBrowser } from "@/lib/parent/browser-client";
import { browserRequestSchema } from "@/lib/parent/browser-policy";
import {
  parentError,
  readParentJson,
  requireSameOrigin,
  uuidSchema,
} from "@/lib/parent/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, { params }: Context) {
  try {
    return await applicationBrowser(uuidSchema.parse((await params).id), "GET");
  } catch (error) {
    return parentError(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request);
    browserRequestSchema.parse(await readParentJson(request));
    return await applicationBrowser(
      uuidSchema.parse((await params).id),
      "POST",
    );
  } catch (error) {
    return parentError(error);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request);
    return await applicationBrowser(
      uuidSchema.parse((await params).id),
      "DELETE",
    );
  } catch (error) {
    return parentError(error);
  }
}
