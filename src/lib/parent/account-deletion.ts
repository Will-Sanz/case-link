import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthenticationRequiredError } from "@/lib/auth/session-errors";
import { createParentClient } from "./auth";

const parentDeletionStatusSchema = z.enum(["active", "deletion_requested"]);
async function verifyIdentity(client: SupabaseClient) {
  let result;
  try { result = await client.auth.getUser(); } catch { throw new Error("Parent deletion service is not available. Please try again."); }
  if (result.error) {
    if ([400, 401, 403].includes(result.error.status ?? 0)) throw new AuthenticationRequiredError();
    throw new Error("Parent deletion service is not available. Please try again.");
  }
  const user = result.data.user;
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous || !z.uuid().safeParse(user.id).success)
    throw new AuthenticationRequiredError();
  return user.id;
}
function check(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "42501") throw new AuthenticationRequiredError();
  throw new Error("Parent deletion service is not available. Please try again.");
}

/** Metadata only: existing ownership/live session are checked in SQL without enrollment or processing access. */
export async function getParentDeletionStatus(client: SupabaseClient) {
  const ownerId = await verifyIdentity(client);
  const { data, error } = await client.rpc("parent_get_deletion_status");
  check(error);
  const value = parentDeletionStatusSchema.safeParse(data);
  if (!value.success) throw new Error("Parent deletion service is not available. Please try again.");
  return { ownerId, status: value.data };
}

export async function requestAccountDeletion(expectedOwnerId: string): Promise<void> {
  const client = await createParentClient();
  const ownerId = await verifyIdentity(client);
  if (!z.uuid().safeParse(expectedOwnerId).success || expectedOwnerId !== ownerId) throw new Error("parent_deletion_owner_changed");
  const { data, error } = await client.rpc("parent_request_deletion");
  check(error);
  if (data !== null) throw new Error("Parent deletion service is not available. Please try again.");
}
