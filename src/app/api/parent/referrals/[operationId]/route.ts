import { trustedReferral } from "@/lib/parent/activity";
import {
  parentError,
  parentJson,
  readParentJson,
  requireSameOrigin,
  uuidSchema,
} from "@/lib/parent/http";
type Context = { params: Promise<{ operationId: string }> };
export async function GET(_: Request, { params }: Context) {
  try {
    return parentJson({
      ok: true,
      referral: await trustedReferral(
        uuidSchema.parse((await params).operationId),
      ),
    });
  } catch (error) {
    return parentError(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request);
    return parentJson({
      ok: true,
      receipt: await trustedReferral(
        uuidSchema.parse((await params).operationId),
        await readParentJson(request),
      ),
    });
  } catch (error) {
    return parentError(error);
  }
}
