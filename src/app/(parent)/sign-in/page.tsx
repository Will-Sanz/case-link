import type { Metadata } from "next";
import { ParentSignIn } from "@/features/parent/sign-in";
import { canonicalProjectOrigin } from "@/lib/parent/project-origin";
import { parentEmailCodeEnabled } from "@/lib/parent/configuration";
export const metadata: Metadata = { title: "Sign in" };
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; message?: string; error?: string; purpose?: string }>;
}) {
  const { next, message, error, purpose } = await searchParams;
  const recovery = canonicalProjectOrigin(process.env.CASELINK_PARENT_RECOVERY_SITE_URL);
  return (
    <ParentSignIn
      returnTo={next}
      deletionOnly={purpose === "delete-parent-data"}
      existingAccountRecovery={
        process.env.CASELINK_PARENT_ACCOUNT_MODE === "existing"
      }
      recoveryHref={
        process.env.CASELINK_PARENT_ACCOUNT_MODE === "existing" && recovery?.startsWith("https://")
          ? `${recovery}/forgot-password`
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
