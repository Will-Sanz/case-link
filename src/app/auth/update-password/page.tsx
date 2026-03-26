import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { UpdatePasswordForm } from "@/features/auth/update-password-form";

export const dynamic = "force-dynamic";

export default function UpdatePasswordPage() {
  return (
    <AuthShell
      title="CaseLink"
      subtitle="Set a new password for your account."
    >
      <h2 className="text-base font-semibold text-slate-900">Choose a new password</h2>
      <p className="mt-2 text-sm text-slate-600">
        {`Use the form below after opening the reset link from your email. The email with the button is titled something like "Reset your password", not the "password changed" notice you get afterward.`}
      </p>
      <div className="mt-5">
        <UpdatePasswordForm />
      </div>
      <p className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
        <Link href="/login" className="font-medium text-blue-600/90 underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
