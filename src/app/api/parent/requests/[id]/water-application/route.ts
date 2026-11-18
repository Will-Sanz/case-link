import { z } from "zod";
import { getWaterApplicationCollection, getWaterApplicationDetails, saveWaterApplicationDetails, waterApplicationWriteSchema } from "@/lib/parent/water-application-data";
import { parentError, parentJson, readParentJson, requireSameOrigin, uuidSchema } from "@/lib/parent/http";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const id = uuidSchema.parse((await params).id);
    const revision = z.uuid().optional().parse(new URL(request.url).searchParams.get("revision") ?? undefined);
    const snapshot = await getWaterApplicationDetails(id, revision);
    return snapshot ? parentJson({ ok: true, snapshot }) : parentJson({ ok: false, error: "This saved preparation is unavailable." }, 404);
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await params).id);
    const authorization = await getWaterApplicationCollection();
    if (!authorization.collectionEnabled) throw new Error("This request is unavailable, or its permission has changed.");
    const value = waterApplicationWriteSchema.parse(await readParentJson(request, 65536));
    const key = uuidSchema.parse(request.headers.get("idempotency-key"));
    const snapshotId = await saveWaterApplicationDetails(id, value, key);
    return parentJson({ ok: true, snapshotId }, 201);
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
