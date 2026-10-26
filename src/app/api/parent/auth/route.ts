import { z } from "zod";
import { createParentClient } from "@/lib/parent/auth";
import { parentEmailCodeEnabled } from "@/lib/parent/configuration";
import {
  parentError,
  parentJson,
  readParentJson,
  requireSameOrigin,
} from "@/lib/parent/http";

const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("sign_in"),
      email: z.email().max(254),
      password: z.string().min(1).max(1024),
      captchaToken: z.string().max(4000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("send_code"),
      email: z.email().max(254),
      captchaToken: z.string().max(4000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("verify_code"),
      email: z.email().max(254),
      token: z.string().regex(/^\d{6,10}$/),
    })
    .strict(),
  z.object({ action: z.literal("sign_out") }).strict(),
]);
function authServiceError(
  error: { status?: number; code?: string } | null,
): Response | null {
  if (error?.code === "captcha_failed")
    return parentJson(
      {
        ok: false,
        error:
          "Secure sign-in verification is unavailable right now. Try again later or use the direct support options.",
      },
      503,
    );
  if (error && (!error.status || error.status >= 500))
    return parentJson(
      {
        ok: false,
        error: "Sign-in is temporarily unavailable. Please try again.",
      },
      503,
    );
  return null;
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const value = schema.parse(await readParentJson(request));
    if (
      (value.action === "send_code" || value.action === "verify_code") &&
      !parentEmailCodeEnabled(process.env)
    )
      return parentJson(
        {
          ok: false,
          error:
            "Email-code sign-in is not enabled here. Use your existing CaseLink password or reset it.",
        },
        403,
      );
    const client = await createParentClient();
    if (value.action === "send_code") {
      const result = await client.auth.signInWithOtp({
        email: value.email,
        options: { shouldCreateUser: true, captchaToken: value.captchaToken },
      });
      if (result.error?.status === 429)
        return parentJson(
          {
            ok: false,
            error: "Please wait a minute before requesting another code.",
          },
          429,
        );
      const serviceError = authServiceError(result.error);
      if (serviceError) return serviceError;
      // The same response prevents disclosure of whether an email already has an account.
      return parentJson({
        ok: true,
        message: "If this email can receive a code, it will arrive shortly.",
      });
    }
    if (value.action === "verify_code" || value.action === "sign_in") {
      const result =
        value.action === "sign_in"
          ? await client.auth.signInWithPassword({
              email: value.email.trim().toLowerCase(),
              password: value.password,
              options: { captchaToken: value.captchaToken },
            })
          : await client.auth.verifyOtp({
              email: value.email,
              token: value.token,
              type: "email",
            });
      if (result.error?.status === 429)
        return parentJson(
          {
            ok: false,
            error:
              "Too many sign-in attempts. Wait a few minutes and try again.",
          },
          429,
        );
      const serviceError = authServiceError(result.error);
      if (serviceError) return serviceError;
      if (result.error)
        return parentJson(
          {
            ok: false,
            error:
              value.action === "sign_in"
                ? "Could not sign in. Check your email and password and try again."
                : "That code is incorrect or expired. Check it or request a new code.",
          },
          400,
        );
      const account = await client.rpc("parent_ensure_account");
      if (account.error) {
        await client.auth.signOut({ scope: "local" });
        return parentJson(
          {
            ok: false,
            error:
              account.error.code === "42501"
                ? "Parent support is unavailable for this sign-in. Use the direct support options or contact CaseLink."
                : "Parent support is temporarily unavailable. Please try again.",
          },
          account.error.code === "42501" ? 403 : 503,
        );
      }
      return parentJson({ ok: true });
    }
    const result = await client.auth.signOut({ scope: "local" });
    if (result.error) throw result.error;
    return parentJson({ ok: true });
  } catch (error) {
    return parentError(error);
  }
}
