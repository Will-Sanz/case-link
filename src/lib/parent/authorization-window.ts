import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";

const windowSchema = z
  .object({
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export async function getParentAuthorizationWindow() {
  const { supabase } = await requireParentSession();
  const { data, error } = await supabase.rpc("parent_authorization_window");
  if (error)
    throw new Error("Authorization timing is temporarily unavailable.");
  const window = windowSchema.parse(data);
  return {
    issuedAt: new Date(window.issuedAt).toISOString(),
    expiresAt: new Date(window.expiresAt).toISOString(),
  };
}
