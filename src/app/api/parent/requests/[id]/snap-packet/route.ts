import { z } from "zod";
import { authorizeSnapPacket, getSnapPacketAuthorization } from "@/lib/parent/snap-packet-data";
import { snapPacketAuthorizationInputSchema, snapPacketAuthorizationScopeSchema } from "@/lib/parent/snap-packet-contract";
import { parentError, parentJson, readParentJson, requireSameOrigin, uuidSchema } from "@/lib/parent/http";

type Context = { params: Promise<{ id: string }> };
const querySchema = snapPacketAuthorizationScopeSchema.extend({
  expectedVersion: z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).pipe(z.number().int().max(2147483647)),
}).strict();
function query(request: Request) {
  const url = new URL(request.url);
  if (url.search.length > 1024) throw new Error("parent_invalid_input");
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!Object.hasOwn(querySchema.shape, key) || Object.hasOwn(values, key)) throw new Error("parent_invalid_input");
    values[key] = value;
  }
  return querySchema.parse(values);
}
export async function GET(request: Request, { params }: Context) {
  try {
    if (request.headers.has("origin")) requireSameOrigin(request);
    if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) throw new Error("parent_origin_denied");
    const id = uuidSchema.parse((await params).id);
    const authorization = await getSnapPacketAuthorization(id, query(request));
    return parentJson({ ok: true, authorization });
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireSameOrigin(request);
    const id = uuidSchema.parse((await params).id);
    if (new URL(request.url).search) throw new Error("parent_invalid_input");
    const input = snapPacketAuthorizationInputSchema.parse(await readParentJson(request, 4096));
    const authorization = await authorizeSnapPacket(id, input);
    return parentJson({ ok: true, authorization }, 201);
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
