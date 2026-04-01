import { AuthShell } from "@/components/layout/auth-shell";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="CaseLink"
      subtitle="Set a new password to secure your account."
    >
      <h2 className="text-base font-semibold text-slate-900">Reset password</h2>
      <div className="mt-5">
        <ResetPasswordForm />
      </div>
    </AuthShell>
  );
}
