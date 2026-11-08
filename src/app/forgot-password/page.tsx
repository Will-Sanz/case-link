import { AuthShell } from "@/components/layout/auth-shell";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";
import { redirect } from "next/navigation";
import { getParentConfig } from "@/lib/parent/config";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  if (
    process.env.CASELINK_PRODUCT === "parent" &&
    process.env.CASELINK_ENVIRONMENT === "connected"
  ) {
    getParentConfig();
    redirect(
      `${process.env.CASELINK_PARENT_RECOVERY_SITE_URL}/forgot-password`,
    );
  }
  return (
    <AuthShell
      title="CaseLink"
      subtitle="Get a secure sign-in link if you can't access your password."
    >
      <h2 className="text-base font-semibold text-[var(--public-ink)]">
        Forgot password
      </h2>
      <div className="mt-5">
        <ForgotPasswordForm />
      </div>
    </AuthShell>
  );
}
