import { z } from "zod";
import { mandateSchema } from "./domain";

export const APPLICATION_BROWSER_ORIGIN = "http://127.0.0.1:3330";
export const COMPASS_ENTRY =
  "https://www.compass.dhs.pa.gov/intake/#/getstarted";
export const browserSessionSchema = z
  .object({
    id: z.uuid(),
    programId: z.literal("snap-pa"),
    status: z.enum([
      "starting",
      "running",
      "needs_parent",
      "blocked",
      "completed",
      "failed",
      "closed",
    ]),
    currentUrl: z.string().nullable(),
    title: z.string().nullable(),
    summary: z.string(),
    updatedAt: z.iso.datetime(),
    canControl: z.literal(false),
    frameUrl: z.string().nullable(),
  })
  .strict();
export type ApplicationBrowserSession = z.infer<typeof browserSessionSchema>;
export const browserResponseSchema = z
  .object({
    ok: z.literal(true),
    available: z.boolean(),
    reason: z.string().nullable(),
    session: browserSessionSchema.nullable(),
  })
  .strict();
export type ApplicationBrowserResponse = z.infer<typeof browserResponseSchema>;
export const browserRequestSchema = z
  .object({ programId: z.literal("snap-pa") })
  .strict();
export const browserAuthoritySchema = z.object({
  id: z.uuid(),
  status: z.string(),
  version: z.number().int().positive(),
  mandate: mandateSchema,
  mandate_revoked_at: z.string().nullable(),
  intake: z.object({ needs: z.array(z.string()) }),
});
export type BrowserAuthority = z.infer<typeof browserAuthoritySchema>;

export function publicBrowserAllowed(
  authority: BrowserAuthority,
  now = Date.now(),
): boolean {
  return (
    authority.status === "active" &&
    !authority.mandate_revoked_at &&
    authority.intake.needs.includes("snap_new") &&
    authority.mandate.accepted &&
    authority.mandate.recipientIds.includes("snap-pa") &&
    authority.mandate.allowedActions.includes("research") &&
    Date.parse(authority.mandate.expiresAt) > now
  );
}

/** This runner has no applicant inputs and must stop before any household form. */
export function compassResourceAllowed(
  value: string,
  mainFrame = false,
): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.origin === "https://www.compass.dhs.pa.gov" ||
        (!mainFrame &&
          ["https://www.google.com", "https://www.gstatic.com"].includes(
            url.origin,
          ) &&
          url.pathname.startsWith("/recaptcha/")))
    );
  } catch {
    return false;
  }
}
export function browserDeadline(
  token: string,
  mandateExpiresAt: string,
  approvedUntil: string,
  now = Date.now(),
): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    if (!Number.isSafeInteger(payload.exp)) return 0;
    return Math.min(
      payload.exp * 1000,
      Date.parse(mandateExpiresAt),
      Date.parse(approvedUntil),
      now + 10 * 60 * 1000,
    );
  } catch {
    return 0;
  }
}
export function browserUnavailable(
  reason = "The private website viewer is unavailable. Your saved request and official application link are still available.",
) {
  return { ok: true as const, available: false, reason, session: null };
}
