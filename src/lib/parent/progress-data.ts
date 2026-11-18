import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { supportProgressSchema, type SupportProgress } from "./progress";

export async function getSupportProgress(id: string): Promise<SupportProgress> {
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_request_progress", {
    p_request_id: z.uuid().parse(id),
  });
  if (error?.code === "42501") throw new Error("This request is unavailable, or its permission has changed.");
  const progress = supportProgressSchema.safeParse(data);
  if (error || !progress.success) throw new Error("CaseLink could not load support progress. Please try again.");
  return progress.data;
}

export async function listSupportProgress(): Promise<
  Record<string, SupportProgress>
> {
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_all_request_progress");
  if (error?.code === "42501") throw new Error("This request is unavailable, or its permission has changed.");
  if (error) throw new Error("CaseLink could not load support progress. Please try again.");
  const progress = z.record(z.uuid(), supportProgressSchema).safeParse(data);
  if (!progress.success) throw new Error("CaseLink could not load support progress. Please try again.");
  return progress.data;
}
