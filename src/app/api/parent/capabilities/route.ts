import { requireParentSession } from "@/lib/parent/auth";
import { parentError, parentJson } from "@/lib/parent/http";

export async function GET() {
  try {
    const { supabase } = await requireParentSession();
    const { data, error } = await supabase.rpc("parent_capability_summary");
    if (error) throw new Error("Program connection status is unavailable.");
    return parentJson({ ok: true, capabilities: data });
  } catch (error) {
    return parentError(error);
  }
}
