import { z } from "zod";
import { clearFamilyProfile, getFamilyProfile, saveFamilyProfile } from "@/lib/parent/family-profile-data";
import { familyProfileClearSchema, familyProfileWriteSchema } from "@/lib/parent/family-profile";
import { parentError, parentJson, readParentJson, requireSameOrigin, uuidSchema } from "@/lib/parent/http";
export async function GET() {
  try { return parentJson({ ok: true, ...await getFamilyProfile() }); }
  catch (error) { return parentError(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const current = await getFamilyProfile();
    if (!current.collection.collectionEnabled) throw new Error("This request is unavailable, or its permission has changed.");
    const value = familyProfileWriteSchema.parse(await readParentJson(request, 65536));
    const key = uuidSchema.parse(request.headers.get("idempotency-key"));
    return parentJson({ ok: true, revision: await saveFamilyProfile(value, key) }, 201);
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const value = familyProfileClearSchema.parse(await readParentJson(request, 2000));
    const key = uuidSchema.parse(request.headers.get("idempotency-key"));
    return parentJson({ ok: true, revision: await clearFamilyProfile(value, key) });
  } catch (error) { return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error); }
}
