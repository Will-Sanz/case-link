"use server";

import { z } from "zod";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { publicSessionError } from "@/lib/auth/session-errors";
import { getPublicSiteOrigin } from "@/lib/auth/public-site-url";

const inputSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), delivery: z.enum(["email", "link"]) }).strict();
const resultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["sent", "existing"]) }),
  z.object({ status: z.literal("link"), tokenHash: z.string().min(32).max(512).regex(/^[a-zA-Z0-9_-]+$/) }),
]);
export type StaffInvitationResult = { ok: false; error: string } | { ok: true; status: "sent" | "existing" | "link"; link?: string };

export async function inviteStaff(input: unknown): Promise<StaffInvitationResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid email address and choose how to invite them." };
  let session;
  try { session = await requireAppUserWithClient(); }
  catch (error) { return { ok: false, error: publicSessionError(error) }; }
  if (session.user.role !== "admin") return { ok: false, error: "Only a workspace administrator can invite users." };
  const origin = await getPublicSiteOrigin();
  if (!origin) return { ok: false, error: "Invitation links are not configured. Contact your administrator." };
  try {
    const result = await session.supabase.functions.invoke("invite-staff", { body: parsed.data });
    if (result.error) {
      const detail = await result.error.context?.json().catch(() => null);
      if (detail?.error === "offboarded") return { ok: false, error: "This account was deactivated. An invitation cannot restore its access." };
      if (detail?.error === "existing_role") return { ok: false, error: "This account already has administrator permissions. Contact your workspace administrator." };
      return { ok: false, error: "The invitation could not be confirmed. Wait at least a minute, then try again." };
    }
    const response = resultSchema.safeParse(result.data);
    if (!response.success) return { ok: false, error: "The invitation could not be confirmed. Try again." };
    if (response.data.status !== "link") return { ok: true, status: response.data.status };
    const link = new URL("/auth/callback", origin);
    link.hash = new URLSearchParams({ token_hash: response.data.tokenHash, type: "invite", next: "/reset-password?mode=setup" }).toString();
    return { ok: true, status: "link", link: link.href };
  } catch {
    return { ok: false, error: "The invitation service is unavailable. Try again." };
  }
}
