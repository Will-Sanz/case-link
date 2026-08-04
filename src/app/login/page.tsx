import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { LoginForm } from "@/features/auth/login-form";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) {
    redirect("/families");
  }

  return (
    <AuthShell
      title="CaseLink"
      subtitle="Sign in to manage family plans and PDF exports."
    >
      <h2 className="text-base font-semibold text-slate-900">Case manager login</h2>
      <div className="mt-5">
        <Suspense
          fallback={<p className="text-sm text-slate-500">Loading…</p>}
        >
          <LoginForm />
        </Suspense>
      </div>
      <p className="mt-6 text-center text-xs text-slate-500">
        <Link href="/" className="font-medium text-slate-600 underline-offset-2 hover:text-slate-800 hover:underline">
          Home
        </Link>
      </p>
    </AuthShell>
  );
}
