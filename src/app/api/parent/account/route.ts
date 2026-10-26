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
      account: { email: user.email, preferences: household.preferences },
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
          })
          .strict(),
      ])
      .parse(await readParentJson(request));
    if (value.action === "delete") await requestAccountDeletion();
    else await updateParentPreferences(value.preferences);
    return parentJson({ ok: true });
  } catch (error) {
    return parentError(error);
  }
}
