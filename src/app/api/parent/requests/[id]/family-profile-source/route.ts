import { z } from "zod";
import { getFamilyProfileSources } from "@/lib/parent/family-profile-data";
import { parentError, parentJson } from "@/lib/parent/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const value = new URL(request.url).searchParams.get("expectedVersion");
    const version = z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).pipe(z.number().int().max(2147483647)).parse(value);
    return parentJson({ ok: true, ...await getFamilyProfileSources(id, version) });
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
