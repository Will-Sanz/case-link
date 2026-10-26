import type { Metadata } from "next";
import { ParentSignIn } from "@/features/parent/sign-in";
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
