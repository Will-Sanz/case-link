import { AuthShell } from "@/components/layout/auth-shell";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="CaseLink"
      subtitle="Get a secure sign-in link if you can't access your password."
    >
      <h2 className="text-base font-semibold text-slate-900">Forgot password</h2>
      <div className="mt-5">
        <ForgotPasswordForm />
      </div>
    </AuthShell>
  );
}
