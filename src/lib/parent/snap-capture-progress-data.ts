import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { snapCaptureProgressSchema, snapCaptureProgressScopeSchema, snapReplacePersonalPagesSchema, type SnapCaptureProgress } from "./snap-capture-progress";

const uuid = z.uuid().transform(value => value.toLowerCase());
const unconfirmed = "CaseLink could not confirm the saved application file. Refresh before trying a different file.";
async function call(name: string, args: Record<string, unknown>) {
  const { supabase } = await requireParentSession();
  let result;
  try { result = await supabase.rpc(name, args); } catch { throw new Error(unconfirmed); }
  if (result.error?.code === "42501") throw new Error("This request is unavailable, or its permission has changed.");
  if (result.error?.code === "40001") throw new Error("This request changed. Reload before replacing its private pages.");
  if (result.error) throw new Error(unconfirmed);
  return result.data;
}

/** Recover the exact server-selected file after return/sign-in; null never proves that a prior upload failed. */
export async function getSnapCaptureProgress(requestId: string, input: unknown): Promise<SnapCaptureProgress | null> {
  const id = uuid.parse(requestId), scope = snapCaptureProgressScopeSchema.parse(input);
  const data = await call("parent_get_snap_current_capture", { p_request: id, p_version: scope.expectedVersion });
  if (data === null) return null;
  const parsed = snapCaptureProgressSchema.safeParse(data);
  if (!parsed.success || parsed.data.requestVersion !== scope.expectedVersion) throw new Error(unconfirmed);
  return parsed.data;
}

/** Explicit correction only. The database preserves original answers/dates and stops superseded queued work. */
export async function replaceSnapPersonalPages(requestId: string, input: unknown): Promise<number> {
  const id = uuid.parse(requestId), value = snapReplacePersonalPagesSchema.parse(input);
  const data = await call("parent_replace_snap_personal_pages", { p_request: id, p_version: value.expectedVersion, p_previous_packet: value.previousPacketId });
  if (data !== value.expectedVersion + 1) throw new Error(unconfirmed);
  return data;
}
