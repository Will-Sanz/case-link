import { z } from "zod";
import { requireParentSession } from "@/lib/parent/auth";
import { actionSchema } from "@/lib/parent/domain";
import { assessFoodSupport, foodAssessmentInputSchema } from "@/lib/parent/food-assessment";
import { parentError, parentJson, readParentJson, requireSameOrigin } from "@/lib/parent/http";
import { getProgramsForNeeds, programRoutingIssue, supportsInitialServiceDelivery } from "@/lib/parent/programs";

const capabilitiesSchema = z.array(z.object({ programId: z.string().max(60), enabled: z.boolean(), actions: z.array(actionSchema).max(6) })).max(100);

/** Read-only routing: no draft, model call, service permission or provider action is created. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = foodAssessmentInputSchema.parse(await readParentJson(request, 2048));
    const { supabase, user } = await requireParentSession();
    const connections = await supabase.rpc("parent_capability_summary");
    const parsed = capabilitiesSchema.safeParse(connections.data);
    if (connections.error || !parsed.success) return parentJson({ ok: false, error: "Current food connections could not be checked. Your answers remain on this page; try again or use the direct program options." }, 503);
    const capabilities = parsed.data, now = new Date();
    return parentJson({ ok: true, ownerId: user.id, candidates: assessFoodSupport(input.answers).map(path => ({
      ...path, programs: getProgramsForNeeds([path.need]).map(program => ({
        programId: program.id,
        actions: !programRoutingIssue(program, undefined, now)
          ? capabilities.filter(value => value.programId === program.id && value.enabled).flatMap(value => value.actions)
            .filter(action => ["share", "submit", "schedule"].includes(action) && supportsInitialServiceDelivery(path.need, action)) : [],
      })),
    })) });
  } catch (error) {
    return parentError(error instanceof z.ZodError ? new Error("parent_invalid_input") : error);
  }
}
