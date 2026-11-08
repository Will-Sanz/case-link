import { z } from "zod";
import { requireParentSession } from "@/lib/parent/auth";
import {
  getHousehold,
  parentPreferencesSchema,
  requestAccountDeletion,
  updateParentPreferences,
} from "@/lib/parent/data";
import {
  parentError,
  parentJson,
  readParentJson,
  requireSameOrigin,
} from "@/lib/parent/http";
export async function GET() {
  try {
    const { user } = await requireParentSession();
    const household = await getHousehold();
    return parentJson({
      ok: true,
      account: { id: user.id, email: user.email, preferences: household.preferences },
    });
  } catch (error) {
    return parentError(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const value = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("preferences"),
            preferences: parentPreferencesSchema,
          })
          .strict(),
        z
          .object({
            action: z.literal("delete"),
            confirmation: z.literal("DELETE"),
            expectedOwnerId: z.uuid({ error: "Reload your account before confirming deletion." }),
          })
          .strict(),
      ])
      .parse(await readParentJson(request));
    if (value.action === "delete") await requestAccountDeletion(value.expectedOwnerId);
    else await updateParentPreferences(value.preferences);
    return parentJson({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "parent_deletion_owner_changed")
      return parentJson({ ok: false, error: "Your signed-in account changed. Reload before confirming deletion." }, 409);
    return parentError(error);
  }
}
