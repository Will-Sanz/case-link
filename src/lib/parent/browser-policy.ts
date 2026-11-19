import { z } from "zod";
import { mandateSchema } from "./domain";

export const APPLICATION_BROWSER_ORIGIN = "http://127.0.0.1:3330";
export const COMPASS_ENTRY =
  "https://www.compass.dhs.pa.gov/intake/#/getstarted";
export const COMPASS_FAMILY_SAFETY =
  "https://www.compass.dhs.pa.gov/intake/#/applynow/gettingstarted/familysafety";
export const COMPASS_CAPTCHA =
  "https://www.compass.dhs.pa.gov/intake/#/applynow/gettingstarted/captcha";
export const COMPASS_INTRODUCTION_END =
  "https://www.compass.dhs.pa.gov/intake/#/applynow/gettingstarted/gettingstartedending";
export const COMPASS_HOUSEHOLD_DIVIDER =
  "https://www.compass.dhs.pa.gov/intake/#/applynow/household";
export const browserControlSchema = z
  .object({
    sessionId: z.uuid(),
    frameId: z.uuid(),
    action: z.discriminatedUnion("type", [
      z.object({ type: z.literal("continue") }).strict(),
      z.object({ type: z.literal("refresh") }).strict(),
      z.object({ type: z.literal("resume") }).strict(),
      z
        .object({
          type: z.literal("click"),
          x: z.number().finite().min(0).max(1),
          y: z.number().finite().min(0).max(1),
        })
        .strict(),
      z
        .object({
          type: z.literal("key"),
          key: z.enum([
            "Tab",
            "Shift+Tab",
            "Enter",
            "Space",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Escape",
          ]),
        })
        .strict(),
    ]),
  })
  .strict();
export type BrowserControl = z.infer<typeof browserControlSchema>;
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
    canControl: z.boolean(),
    frameUrl: z.string().nullable(),
    handoff: z
      .object({
        kind: z.enum(["continue", "challenge"]),
        frameId: z.uuid(),
        width: z.number().int().positive().max(4096),
        height: z.number().int().positive().max(4096),
        expiresAt: z.iso.datetime(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.canControl !== Boolean(value.handoff) ||
      (value.canControl &&
        (value.status !== "needs_parent" ||
          !value.frameUrl ||
          ![COMPASS_FAMILY_SAFETY, COMPASS_CAPTCHA].includes(
            value.currentUrl ?? "",
          )))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Parent control requires the current public verification frame.",
      });
  });
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

/** Only reviewed public challenge frames may receive parent input or appear unmasked. */
export function recaptchaFrameAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      url.origin === "https://www.google.com" &&
      ["/recaptcha/api2/anchor", "/recaptcha/api2/bframe"].includes(
        url.pathname,
      ) &&
      !(
        url.pathname.endsWith("/anchor") &&
        url.searchParams.get("size") === "invisible"
      )
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
