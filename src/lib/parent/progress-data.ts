import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { supportProgressSchema, type SupportProgress } from "./progress";

export async function getSupportProgress(id: string): Promise<SupportProgress> {
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_request_progress", {
    p_request_id: z.uuid().parse(id),
  });
  if (error)
    throw new Error(
      "This request is unavailable, or its permission has changed.",
    );
  return supportProgressSchema.parse(data);
}

export async function listSupportProgress(): Promise<
  Record<string, SupportProgress>
> {
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_all_request_progress");
  if (error) throw new Error("Parent service progress is not available.");
  return z.record(z.uuid(), supportProgressSchema).parse(data);
}
