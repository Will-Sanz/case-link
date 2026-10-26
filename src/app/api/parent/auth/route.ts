import { z } from "zod";
import { createParentClient } from "@/lib/parent/auth";
import {
  parentError,
  parentJson,
  readParentJson,
  requireSameOrigin,
} from "@/lib/parent/http";

const schema = z.discriminatedUnion("action", [
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
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const value = schema.parse(await readParentJson(request));
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
      // The same response prevents disclosure of whether an email already has an account.
      return parentJson({
        ok: true,
        message: "If this email can receive a code, it will arrive shortly.",
      });
    }
    if (value.action === "verify_code") {
      const result = await client.auth.verifyOtp({
        email: value.email,
        token: value.token,
        type: "email",
      });
      if (result.error)
        return parentJson(
          {
            ok: false,
            error:
              "That code is incorrect or expired. Check it or request a new code.",
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
              "This account cannot access parent support. Use your separate parent account.",
          },
          403,
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
