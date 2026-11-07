import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";

const snapApplicationSchema = z.discriminatedUnion("collectionEnabled", [
  z.object({ collectionEnabled: z.literal(false), noticeVersion: z.null() }).strict(),
  z.object({ collectionEnabled: z.literal(true), noticeVersion: z.literal(SNAP_APPLICATION_NOTICE_VERSION) }).strict(),
]);

const windowSchema = z
  .object({
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export async function getParentAuthorizationWindow() {
  const { supabase } = await requireParentSession();
  const [timing, collection] = await Promise.all([
    supabase.rpc("parent_authorization_window"),
    Promise.resolve(supabase.rpc("parent_snap_application_collection")).catch(() => ({ data: null, error: true })),
  ]);
  if (timing.error)
    throw new Error("Authorization timing is temporarily unavailable.");
  const parsed = windowSchema.safeParse(timing.data);
  const snapApplication = snapApplicationSchema.safeParse(collection.error
    ? { collectionEnabled: false, noticeVersion: null } : collection.data);
  if (!parsed.success || !snapApplication.success) throw new Error("Authorization timing is temporarily unavailable.");
  const window = parsed.data;
  return {
    issuedAt: new Date(window.issuedAt).toISOString(),
    expiresAt: new Date(window.expiresAt).toISOString(),
    snapApplication: snapApplication.data,
  };
}
