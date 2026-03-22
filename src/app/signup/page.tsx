import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { SignUpForm } from "@/features/auth/sign-up-form";
import { getSessionUser } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

export const dynamic = "force-dynamic";

export default async function SignUpPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (user) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const next =
    typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "";
  const loginHref =
    next !== "" ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <AuthShell
      title="CaseLink"
      subtitle="Create a secure account for your organization’s case managers."
    >
      <h2 className="text-base font-semibold text-slate-900">Sign up</h2>
      <div className="mt-5">
        <Suspense
          fallback={<p className="text-sm text-slate-500">Loading…</p>}
        >
          <SignUpForm />
        </Suspense>
      </div>
      <p className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link
          href={loginHref}
          className="font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
