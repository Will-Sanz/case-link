import type { Metadata } from "next";
import { ParentSignIn } from "@/features/parent/sign-in";
import { parentEmailCodeEnabled } from "@/lib/parent/configuration";
export const metadata: Metadata = { title: "Sign in" };
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; message?: string; error?: string }>;
}) {
  const { next, message, error } = await searchParams;
  return (
    <ParentSignIn
      returnTo={next}
      existingAccountRecovery={
        process.env.CASELINK_PARENT_ACCOUNT_MODE === "existing"
      }
      recoveryHref={
        process.env.CASELINK_ENVIRONMENT === "connected" &&
        process.env.CASELINK_PARENT_RECOVERY_SITE_URL
          ? `${process.env.CASELINK_PARENT_RECOVERY_SITE_URL}/forgot-password`
          : undefined
      }
      emailCodeAvailable={parentEmailCodeEnabled(process.env)}
      authNotice={
        message === "password-reset-success"
          ? "password-reset-success"
          : error === "auth"
            ? "auth-link-error"
            : undefined
      }
    />
  );
}
