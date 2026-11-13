import { z } from "zod";
import { getPecoApplicationCollection, getPecoApplicationDetails, savePecoApplicationDetails, pecoApplicationWriteSchema } from "@/lib/parent/peco-application-data";
import { parentError, parentJson, readParentJson, requireSameOrigin, uuidSchema } from "@/lib/parent/http";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const id = uuidSchema.parse((await params).id);
    const revision = z.uuid().optional().parse(new URL(request.url).searchParams.get("revision") ?? undefined);
    const snapshot = await getPecoApplicationDetails(id, revision);
    return snapshot ? parentJson({ ok: true, snapshot }) : parentJson({ ok: false, error: "This saved application is unavailable." }, 404);
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await params).id);
    const authorization = await getPecoApplicationCollection();
    if (!authorization.collectionEnabled) throw new Error("This request is unavailable, or its permission has changed.");
    const value = pecoApplicationWriteSchema.parse(await readParentJson(request, 65536));
    const key = uuidSchema.parse(request.headers.get("idempotency-key"));
    const snapshotId = await savePecoApplicationDetails(id, value, key);
    return parentJson({ ok: true, snapshotId }, 201);
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
