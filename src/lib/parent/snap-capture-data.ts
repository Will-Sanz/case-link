import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { snapCaptureContextSchema, snapCaptureScopeSchema, type SnapCaptureContext } from "./snap-capture-context";

/** Current preparation metadata only; this neither acquires protected values nor grants capture permission. */
export async function getSnapCaptureContext(requestId: string, input: unknown): Promise<SnapCaptureContext> {
  const id = z.uuid().transform(value => value.toLowerCase()).parse(requestId), scope = snapCaptureScopeSchema.parse(input);
  const { supabase } = await requireParentSession();
  let result;
  try { result = await supabase.rpc("parent_get_snap_capture_context", { p_request_id: id, p_expected_version: scope.expectedVersion }); }
  catch { throw new Error("The current SNAP application connection is not available."); }
  const { data, error } = result;
  if (error?.code === "42501") throw new Error("This request is unavailable, or its permission has changed.");
  if (error) throw new Error("The current SNAP application connection is not available.");
  const context = snapCaptureContextSchema.safeParse(data);
  if (!context.success) throw new Error("The current SNAP application connection is not available.");
  if (context.data.requestVersion !== scope.expectedVersion || context.data.snapshotId !== scope.snapshotId)
    throw new Error("This request changed. Reload it before using the prepared application.");
  return context.data;
}
