import "server-only";
import { z } from "zod";
import { requireParentSession } from "./auth";
import { SNAP_APPLICATION_NOTICE_VERSION, WIC_APPLICATION_NOTICE_VERSION } from "./constants";
import { pecoApplicationCollectionSchema } from "./peco-application-snapshot";

const snapApplicationSchema = z.discriminatedUnion("collectionEnabled", [
  z.object({ collectionEnabled: z.literal(false), noticeVersion: z.null() }).strict(),
  z.object({ collectionEnabled: z.literal(true), noticeVersion: z.literal(SNAP_APPLICATION_NOTICE_VERSION) }).strict(),
]);
const wicApplicationSchema = z.discriminatedUnion("collectionEnabled", [
  z.object({ collectionEnabled: z.literal(false), noticeVersion: z.null(), expiresAt: z.null() }).strict(),
  z.object({ collectionEnabled: z.literal(true), noticeVersion: z.literal(WIC_APPLICATION_NOTICE_VERSION), expiresAt: z.iso.datetime({ offset: true }) }).strict(),
]);

const windowSchema = z
  .object({
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export async function getParentAuthorizationWindow() {
  const { supabase } = await requireParentSession();
  const [timing, collection, wicCollection, pecoCollection] = await Promise.all([
    supabase.rpc("parent_authorization_window"),
    Promise.resolve(supabase.rpc("parent_snap_application_collection")).catch(() => ({ data: null, error: true })),
    Promise.resolve(supabase.rpc("parent_wic_application_collection")).catch(() => ({ data: null, error: true })),
    Promise.resolve(supabase.rpc("parent_peco_application_collection")).catch(() => ({ data: null, error: true })),
  ]);
  if (timing.error)
    throw new Error("Authorization timing is temporarily unavailable.");
  const parsed = windowSchema.safeParse(timing.data);
  const snapApplication = snapApplicationSchema.safeParse(collection.error
    ? { collectionEnabled: false, noticeVersion: null } : collection.data);
  const wicApplication = wicApplicationSchema.safeParse(wicCollection.error
    ? { collectionEnabled: false, noticeVersion: null, expiresAt: null } : wicCollection.data);
  const pecoApplication = pecoApplicationCollectionSchema.safeParse(pecoCollection.error
    ? { collectionEnabled: false, noticeVersion: null, expiresAt: null } : pecoCollection.data);
  if (!parsed.success || !snapApplication.success || !wicApplication.success || !pecoApplication.success) throw new Error("Authorization timing is temporarily unavailable.");
  const window = parsed.data;
  return {
    issuedAt: new Date(window.issuedAt).toISOString(),
    expiresAt: new Date(window.expiresAt).toISOString(),
    snapApplication: snapApplication.data,
    wicApplication: wicApplication.data,
    pecoApplication: pecoApplication.data,
  };
}
